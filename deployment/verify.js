const hre = require("hardhat");
const fs = require("fs");

async function main() {
  // Load deployments from sepolia.json
  const deploymentsPath = "./deployments/sepolia.json";
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error(`Deployments file not found at ${deploymentsPath}`);
  }
  
  const rawData = fs.readFileSync(deploymentsPath);
  const deployments = JSON.parse(rawData);
  
  // Get network name from hardhat config
  const networkName = hre.network.name;
  console.log(`Verifying contracts on ${networkName}...`);
  
  // Verify each contract  for (const [contractName, contractInfo] of Object.entries(deployments)) {
    if (!contractInfo || !contractInfo.address) {
      console.log(`Skipping ${contractName}: no address found`);
      continue;
    }
        const address = contractInfo.address;
    // Constructor arguments are stored in the deployment by hardhat-deploy
    const args = contractInfo.args || [];
    
    console.log(`Verifying ${contractName} at ${address}...`);
    try {
      await hre.run("etherscan-verify", {
        address,
        constructorArguments: args
      });
      console.log(` Successfully verified ${contractName}`);
    } catch (error) {
      // Handle already verified error
      if (error.message.toLowerCase().includes("already verified")) {
        console.log(`  ${contractName} already verified on Etherscan`);
      } else {
        console.error(` Failed to verify ${contractName}:`, error.message);
        // Continue with other contracts instead of failing entirely
      }
    }
  }
  
  console.log("Verification process completed");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Verification script failed:", error);
    process.exit(1);
  });