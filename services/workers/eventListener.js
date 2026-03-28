require('dotenv').config();
const { Client } = require('pg');
const { ethers } = require('ethers');

// Validate required environment variables
const requiredEnvVars = ['SEPOLIA_RPC_URL', 'REGISTRY_ADDRESS', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];
for (const varName of requiredEnvVars) {
  if (!process.env[varName]) {
    console.error(`Missing required environment variable: ${varName}`);
    process.exit(1);
  }
}

// Initialize Ethereum provider
const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);

// Initialize PostgreSQL client
const pgClient = new Client({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
});

// Connect to PostgreSQL with error handling
pgClient.connect()
  .then(() => console.log('Connected to PostgreSQL'))
  .catch(err => {
    console.error('Failed to connect to PostgreSQL:', err);
    process.exit(1);
  });

// Whitelist of allowed table names to prevent SQL injection
const ALLOWED_TABLES = new Set([
  'governor_events',
  'treasury_events',
  'delegation_events'
]);

// Contract ABIs (minimal for events we need to index)
const governorAbi = [
  "event ProposalCreated(uint256 id, address proposer)",
  "event Voted(uint256 id, address voter, uint256 power, bool support)",
  "event ProposalExecuted(uint256 id)",
  "event QuorumNotMet(uint256 id, uint256 votes, uint256 quorum)",
  "event ProposalFailed(uint256 id)"
];

const treasuryAbi = [
  "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
  "event Withdrawal(address indexed sender, address indexed receiver, uint256 assets, uint256 shares)"
];

const delegationAbi = [
  "event Locked(address indexed delegator, uint256 amount, uint256 unlockBlock)",
  "event Unlocked(address indexed delegator, uint256 amount)",
  "event Delegated(address indexed delegator, address indexed delegatee, uint256 multiplier)",
  "event Slashed(address indexed delegator, uint256 amount)"
];

// Get contract addresses from Registry
async function getContractAddresses() {
  try {
    const registryAbi = [
      "function getGovernor() view returns (address)",
      "function getTreasury() view returns (address)",
      "function getQuadraticVoting() view returns (address)"
    ];
    const registry = new ethers.Contract(process.env.REGISTRY_ADDRESS, registryAbi, provider);
    const [governorAddr, treasuryAddr, quadraticVotingAddr] = await Promise.all([
      registry.getGovernor(),
      registry.getTreasury(),
      registry.getQuadraticVoting()
    ]);
    return { governorAddr, treasuryAddr, quadraticVotingAddr };
  } catch (err) {
    console.error('Failed to fetch contract addresses from Registry:', err);
    process.exit(1);
  }
}

// Insert event into PostgreSQL with table name validation
async function insertEvent(tableName, eventData) {
  if (!ALLOWED_TABLES.has(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
  
  const columns = Object.keys(eventData).join(', ');
  const placeholders = Object.keys(eventData).map((_, i) => `$${i + 1}`).join(', ');
  const values = Object.values(eventData);
  
  const query = `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`;
  
  try {
    await pgClient.query(query, values);
  } catch (err) {
    console.error(`Error inserting into ${tableName}:`, err);
    throw err; // Re-throw to be caught by caller
  }
}

// Setup listeners for a contract's events
function setupContractListeners(contract, tableName, eventHandlers) {
  Object.entries(eventHandlers).forEach(([eventName, handler]) => {
    contract.on(eventName, async (...args) => {
      try {
        // Extract event args (last arg is the event object)
        const eventArgs = args[args.length - 1];
        const eventData = handler(args, eventArgs);
        await insertEvent(tableName, eventData);
      } catch (err) {
        console.error(`Error processing ${eventName} event:`, err);
        // Continue listening despite individual event errors
      }
    });
  });
}

// Main function to start all listeners
async function startListeners() {
  try {
    const { governorAddr, treasuryAddr } = await getContractAddresses();
    
    // Initialize contracts
    const governor = new ethers.Contract(governorAddr, governorAbi, provider);
    const treasury = new ethers.Contract(treasuryAddr, treasuryAbi, provider);
    // Note: Delegation address would come from another registry function in a full implementation
    // For now, we'll skip delegation events as address source isn't specified in contracts we have
    
    // Define event handlers for each contract
    const governorHandlers = {
      ProposalCreated: ([id, proposer], event) => ({
        event_type: 'ProposalCreated',
        block_number: event.blockNumber,
        transaction_hash: event.transactionHash,
        proposal_id: id.toString(),
        proposer: proposer.toLowerCase()
      }),
      Voted: ([id, voter, power, support], event) => ({
        event_type: 'Voted',
        block_number: event.blockNumber,
        transaction_hash: event.transactionHash,
        proposal_id: id.toString(),
        voter: voter.toLowerCase(),
        power: power.toString(),
        support: support
      }),
      ProposalExecuted: ([id], event) => ({
        event_type: 'ProposalExecuted',
        block_number: event.blockNumber,
        transaction_hash: event.transactionHash,
        proposal_id: id.toString()
      }),
      QuorumNotMet: ([id, votes, quorum], event) => ({
        event_type: 'QuorumNotMet',
        block_number: event.blockNumber,
        transaction_hash: event.transactionHash,
        proposal_id: id.toString(),
        votes: votes.toString(),
        quorum: quorum.toString()
      }),
      ProposalFailed: ([id], event) => ({
        event_type: 'ProposalFailed',
        block_number: event.blockNumber,
        transaction_hash: event.transactionHash,
        proposal_id: id.toString()
      })
    };
    
    const treasuryHandlers = {
      Deposit: ([sender, owner, assets, shares], event) => ({
        event_type: 'Deposit',
        block_number: event.blockNumber,
        transaction_hash: event.transactionHash,
        sender: sender.toLowerCase(),
        owner: owner.toLowerCase(),
        assets: assets.toString(),
        shares: shares.toString()
      }),
      Withdrawal: ([sender, receiver, assets, shares], event) => ({
        event_type: 'Withdrawal',
        block_number: event.blockNumber,
        transaction_hash: event.transactionHash,
        sender: sender.toLowerCase(),
        receiver: receiver.toLowerCase(),
        assets: assets.toString(),
        shares: shares.toString()
      })
    };
    
    // Setup listeners
    setupContractListeners(governor, 'governor_events', governorHandlers);
    setupContractListeners(treasury, 'treasury_events', treasuryHandlers);
    // Delegation listener would be added here if we had the address
    
    console.log('Event listeners started successfully');
  } catch (err) {
    console.error('Failed to start listeners:', err);
    process.exit(1);
  }
}

// Start the listeners
startListeners().catch(err => {
  console.error('Unhandled error in startListeners:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await pgClient.end();
  process.exit(0);
});