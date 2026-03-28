const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');

// ABI minimums for contracts we interact with
const registryABI = [
  "function getGovernor() view returns (address)",
  "function getTreasury() view returns (address)",
  "function getQuadraticVoting() view returns (address)"
];

const governorABI = [
  "function propose(address[] targets, uint256[] values, string[] signatures, bytes[] calldatas) returns (uint256)",
  "function vote(uint256 proposalId, bool support, uint256 power, bytes calldata proof) returns (bool)"
];

const treasuryABI = [
  "function totalAssets() view returns (uint256)",
  "function deposit(uint256 assets) returns (uint256 shares)",
  "function withdraw(uint256 shares) returns (uint256 assets)"
];

const votingABI = [
  "function getPower(address account) view returns (uint256)",
  "function totalPower() view returns (uint256)"
];

const delegationABI = [
  "function delegatee(address account) view returns (address)",
  "function lockedBalance(address account) view returns (uint256)",
  "function delegationMultiplier(address account) view returns (uint256)",
  "function lockTimestamp(address account) view returns (uint256)",
  "function lockDuration() view returns (uint256)",
  "function slashPenalty() view returns (uint256)"
];

const reputationABI = [
  "function getScore(address agent) view returns (uint256)",
  "function getMerkleRoot() view returns (bytes32)"
];

// Environment variables
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "http://127.0.0.1:8545";
const REGISTRY_ADDRESS = process.env.REGISTRY_ADDRESS;
const KNOWN_AI_AGENTS = process.env.KNOWN_AI_AGENTS ? 
  process.env.KNOWN_AI_AGENTS.split(',').map(a => a.trim().toLowerCase()) : 
  [];
const REPUTATION_THRESHOLD = parseInt(process.env.REPUTATION_THRESHOLD) || 50;

// Initialize provider and contracts
const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
let registry, governor, treasury, voting, delegation, reputation;

// Initialize contracts on first useasync function initContracts() {
  if (registry) return;
  
  registry = new ethers.Contract(REGISTRY_ADDRESS, registryABI, provider);
  const governorAddress = await registry.getGovernor();
  const treasuryAddress = await registry.getTreasury();
  const votingAddress = await registry.getQuadraticVoting();
  
  governor = new ethers.Contract(governorAddress, governorABI, provider);
  treasury = new ethers.Contract(treasuryAddress, treasuryABI, provider);
  voting = new ethers.Contract(votingAddress, votingABI, provider);
  
  // Delegation and Reputation addresses would come from registry in a full implementation
  // For MVP, we'll use placeholders - in reality these would be set via registry or env  const delegationAddress = process.env.DELEGATION_ADDRESS || "0x0000000000000000000000000000000000000000";
  const reputationAddress = process.env.REPUTATION_ADDRESS || "0x0000000000000000000000000000000000000000";
  
  delegation = new ethers.Contract(delegationAddress, delegationABI, provider);
  reputation = new ethers.Contract(reputationAddress, reputationABI, provider);
}

// In-memory vote storage (for MVP)
const votes = [];

// Middleware to verify delegation and reputation
async function verifyDelegationAndReputation(req, res, next) {
  try {
    await initContracts();
    const voterAddress = req.user.address.toLowerCase();
    
    // Get delegation info
    const delegatee = await delegation.delegatee(voterAddress);
    const lockedBalance = await delegation.lockedBalance(voterAddress);
    const multiplier = await delegation.delegationMultiplier(voterAddress);
    const lockTime = await delegation.lockTimestamp(voterAddress);
    const lockDuration = await delegation.lockDuration();
    const currentBlock = await provider.getBlockNumber();
    
    // Check if lock is expired
    if (currentBlock >= lockTime + lockDuration) {
      return res.status(403).json({ error: "Delegation lock has expired" });
    }
    
    // Calculate voting power: sqrt(lockedBalance * multiplier)
    const balanceNum = lockedBalance.toString();
    const multNum = multiplier.toString();
    // Using JavaScript Math.sqrt for MVP - in production use fixed point math
    const power = Math.floor(Math.sqrt(parseFloat(balanceNum) * parseFloat(multNum)));
    
    // Check reputation if delegatee is a known AI agent
    const delegateeLower = delegatee.toString().toLowerCase();
    if (KNOWN_AI_AGENTS.includes(delegateeLower)) {
      const score = await reputation.getScore(delegatee);
      if (score < REPUTATION_THRESHOLD) {
        return res.status(403).json({ error: "Agent reputation below threshold" });
      }
    }
    
    // Attach to request for use in handler
    req.voterInfo = {
      address: voterAddress,
      delegatee,
      power,
      lockedBalance,
      multiplier
    };
    next();
  } catch (err) {
    console.error("Delegation/reputation verification error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// POST /vote - submit a signed vote
router.post('/vote', async (req, res) => {
  try {
    await initContracts();
    const { proposalId, support, signature } = req.body;
    
    // Verify signature matches voter address
    const message = ethers.encodePacked(
      ["uint256", "bool"],
      [proposalId, support]
    );
    const msgHash = ethers.keccak256(message);
    const recovered = ethers.recoverAddress(msgHash, signature);
    
    if (recovered.toLowerCase() !== req.voterInfo.address.toLowerCase()) {
      return res.status(401).json({ error: "Invalid signature" });
    }
    
    // Record vote (in MVP, we just store in memory)
    votes.push({
      proposalId,
      voter: req.voterInfo.address,
      support,
      timestamp: new Date(),
      power: req.voterInfo.power
    });
    
    // In a full implementation, we would submit to governor contract here
    // await governor.vote(proposalId, support, req.voterInfo.power, "0x");
    
    res.json({ 
      success: true, 
      message: "Vote recorded",
      votePower: req.voterInfo.power
    });
  } catch (err) {
    console.error("Vote error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /proposal - simulate a proposal and get gas estimate
router.post('/proposal', async (req, res) => {
  try {
    await initContracts();
    const { targets, values, signatures, calldatas } = req.body;
    
    // Basic validation
    if (!targets || targets.length === 0) {
      return res.status(400).json({ error: "Targets array required