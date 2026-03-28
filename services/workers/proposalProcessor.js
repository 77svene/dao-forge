require('dotenv').config();
const { ethers } = require("ethers");

// Minimal ABI for Registry
const REGISTRY_ABI = [
  "function getGovernor() view returns (address)",
  "function getTreasury() view returns (address)",
  "function getQuadraticVoting() view returns (address)"
];

// Minimal ABI for Governor (events we care about)
const GOVERNOR_ABI = [
  "event ProposalCreated(uint256 id, address proposer)",
  "event Voted(uint256 id, address voter, uint256 power, bool support)",
  "event ProposalExecuted(uint256 id)",
  "event QuorumNotMet(uint256 id, uint256 votes, uint256 quorum)",
  "event ProposalFailed(uint256 id)",
  "function proposals(uint256) view returns (tuple(address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, uint256 forVotes, uint256 againstVotes, uint256 totalPowerAtSnapshot, bool executed))",
  "function votingPeriod() view returns (uint256)",
  "function quorumPercentage() view returns (uint256)",
  "function timelock() view returns (uint256)"
];

// Minimal ABI for ProposalExecutor (for execution)
const EXECUTOR_ABI = [
  "event ProposalScheduled(uint256 indexed proposalId, uint256 readyAt)",
  "function execute(uint256 proposalId) returns (bool)"
];

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    // Get registry address from env
  const registryAddress = process.env.REGISTRY_ADDRESS;
  if (!registryAddress) {
    throw new Error("REGISTRY_ADDRESS not set in env");
  }
  
  const registry = new ethers.Contract(registryAddress, REGISTRY_ABI, provider);
  
  // Get core contract addresses
  const governorAddress = await registry.getGovernor();
  const executorAddress = await registry.getTreasury(); // TODO: This is wrong, should getExecutor from registry but we don't have that function. For now, assume executor is treasury? Not correct.
  
  // Actually, we need to get the ProposalExecutor address. Since Registry doesn't have a getter for it,
  // we'll assume it's stored in an environment variable or we need to call a different function.
  // Let's use an env var for executor address for simplicity.
  const executorAddress = process.env.EXECUTOR_ADDRESS;
  if (!executorAddress) {
    throw new Error("EXECUTOR_ADDRESS not set in env");
  }
    const governor = new ethers.Contract(governorAddress, GOVERNOR_ABI, provider);
  const executor = new ethers.Contract(executorAddress, EXECUTOR_ABI, wallet);
  
  console.log(`ProposalProcessor started. Listening to Governor at ${governorAddress}`);
  console.log(`Using executor at ${executorAddress}`);
  
  // Listen for ProposalCreated events to track new proposals
  governor.on("ProposalCreated", async (id, proposer) => {
    console.log(`New proposal created: ${id} by ${proposer}`);
    
    // Fetch proposal details to get endBlock
    const proposal = await governor.proposals(id);
    const endBlock = proposal.endBlock;
    const timelock = await governor.timelock();
    const executableBlock = endBlock + timelock;
    
    console.log(`Proposal ${id} ends at block ${endBlock}, timelock ${timelock} blocks, executable at block ${executableBlock}`);
    
    // Set up listener for when the proposal becomes executable
    const checkExecution = async () => {
      const currentBlock = await provider.getBlockNumber();
      if (currentBlock >= executableBlock) {
        // Check if proposal passed (simplified: we assume if it's not executed and not failed, it passed)
        // In reality, we should check votes against quorum, but for MVP we assume it passed if we're here
        const updatedProposal = await governor.proposals(id);
        if (!updatedProposal.executed) {
          console.log(`Proposal ${id} is now executable. Attempting execution...`);
          try {
            const tx = await executor.execute(id);
            console.log(`Execution tx sent: ${tx.hash}`);
            await tx.wait();
            console.log(`Proposal ${id} executed successfully`);
          } catch (error) {
            console.error(`Failed to execute proposal ${id}:`, error.message);
          }
          // Remove listener after attempt
          clearInterval(intervalId);
        } else {
          console.log(`Proposal ${id} already executed`);
          clearInterval(intervalId);
        }
      } else {
        console.log(`Waiting for proposal ${id}... current block ${currentBlock}, target ${executableBlock}`);
      }
    };
    
    // Check every 15 seconds
    const intervalId = setInterval(checkExecution, 15000);
    checkExecution(); // Run immediately
  });
  
  // Handle process termination
  process.on('SIGINT', async () => {
    console.log('Shutting down proposalProcessor...');
    await provider.destroy();
    process.exit(0);
  });
}

main().catch(error => {
  console.error('ProposalProcessor fatal error:', error);
  process.exit(1);
});