require('dotenv').config();

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || '';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

if (!SEPOLIA_RPC_URL) {
  console.error(' SEPOLIA_RPC_URL is not set in .env file');
  process.exit(1);
}

if (!PRIVATE_KEY) {
  console.error(' PRIVATE_KEY is not set in .env file');
  process.exit(1);
}

console.log(' Sepolia configuration loaded');
console.log(`   RPC URL: ${SEPOLIA_RPC_URL.substring(0, 30)}...`);
console.log(`   Account: ${PRIVATE_KEY.substring(0, 6)}...${PRIVATE_KEY.slice(-4)}`);

module.exports = {
  sepolia: {
    url: SEPOLIA_RPC_URL,
    accounts: [PRIVATE_KEY],
    chainId: 11155111,
  },
};