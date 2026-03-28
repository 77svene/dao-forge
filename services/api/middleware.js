const { ethers } = require("ethers");

// Hardhat node RPC URL (local Sepolia fork)
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const provider = new ethers.JsonRpcProvider(RPC_URL);

// ReputationOracle ABI (minimal for getCurrentRoot)
const REPUTATION_ORACLE_ABI = [
  {
    "inputs": [],
    "name": "getCurrentRoot",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

// ReputationOracle address from environment (set after deployment)
const REPUTATION_ORACLE_ADDRESS = process.env.REPUTATION_ORACLE_ADDRESS;
if (!REPUTATION_ORACLE_ADDRESS) {
  throw new Error("REPUTATION_ORACLE_ADDRESS environment variable is required");
}

const reputationOracle = new ethers.Contract(
  REPUTATION_ORACLE_ADDRESS,
  REPUTATION_ORACLE_ABI,
  provider
);

/**
 * Verify SIWE (Sign-In with Ethereum) message and signature
 * Expects Authorization header: "Bearer <siwe-message>:<signature>"
 * Sets req.user to the recovered address if valid
 */
async function authenticateSIWE(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or invalid Authorization header" });
    }

    const token = authHeader.slice(7); // Remove "Bearer "
    const [message, signature] = token.split(":");
    if (!message || !signature) {
      return res.status(400).json({ error: "Invalid token format" });
    }

    // Recover address from signature
    const recoveredAddress = ethers.verifyMessage(message, signature);
    if (!ethers.isAddress(recoveredAddress)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    // Basic SIWE message validation (checks for required fields)
    if (!message.includes("daoforge.com") || !message.includes("requested at")) {
      return res.status(401).json({ error: "Invalid SIWE message" });
    }

    // Prevent replay attacks by checking timestamp (within 5 minutes)
    const timestampMatch = message.match(/timestamp: (\d+)/);
    if (!timestampMatch) {
      return res.status(401).json({ error: "Missing timestamp in SIWE message" });
    }
    const timestamp = parseInt(timestampMatch[1]);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > 300) { // 5 minutes      return res.status(401).json({ error: "SIWE message expired" });
    }

    // Store user address for downstream middleware/routes
    req.user = recoveredAddress.toLowerCase();
    next();
  } catch (error) {
    console.error("SIWE verification error:", error);
    res.status(500).json({ error: "Internal server error during authentication" });
  }
}

/**
 * Check that ReputationOracle has a non-zero root
 * Throws if root is zero (indicating oracle not initialized)
 */
async function checkReputationRoot(req, res, next) {
  try {
    const root = await reputationOracle.getCurrentRoot();
    if (root === ethers.zeroHash) {
      return res.status(503).json({ error: "Reputation oracle not initialized" });
    }
    // Attach root to request for potential use in routes
    req.reputationRoot = root;
    next();
  } catch (error) {
    console.error("Reputation oracle check error:", error);
    res.status(503).json({ error: "Failed to verify reputation oracle" });
  }
}

/**
 * Central error handling middleware
 */
function errorHandler(err, req, res, next) {
  console.error("Unhandled error:", err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack })
  });
}

module.exports = {
  authenticateSIWE,
  checkReputationRoot,
  errorHandler
};