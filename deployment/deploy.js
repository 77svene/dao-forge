const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  console.log("Deploying contracts with account:", deployer);
  console.log("Network:", hre.network.name);

  // Deploy ERC20 mock for governance token
  const erc20Deployment = await deploy("ERC20Mock", {
    from: deployer,
    args: ["DAOForge Governance Token", "DAOG", 18],
    log: true,
  });

  // Deploy QuadraticVoting module
  const quadraticVotingDeployment = await deploy("QuadraticVoting", {
    from: deployer,
    args: [],
    log: true,
  });

  // Deploy Treasury (ERC4626 vault)
  const treasuryDeployment = await deploy("Treasury", {
    from: deployer,
    args: [],
    log: true,
  });

  // Deploy Governor
  const governorDeployment = await deploy("Governor", {
    from: deployer,
    args: [],
    log: true,
  });

  // Deploy Registry (depends on Governor, Treasury, QuadraticVoting)
  const registryDeployment = await deploy("Registry", {
    from: deployer,
    args: [
      governorDeployment.address,
      treasuryDeployment.address,
      quadraticVotingDeployment.address
    ],
    log: true,
  });

  // Deploy Delegation module
  const delegationDeployment = await deploy("Delegation", {
    from: deployer,
    args: [
      erc20Deployment.address,
      10000, // lockDuration (blocks)
      500    // slashPenalty (basis points)
    ],
    log: true,
  });

  // Deploy ProposalExecutor
  const proposalExecutorDeployment = await deploy("ProposalExecutor", {
    from: deployer,
    args: [
      registryDeployment.address,
      2000   // timelock (blocks)
    ],
    log: true,
  });

  // Deploy PriceFeed oracle
  const priceFeedDeployment = await deploy("PriceFeed", {
    from: deployer,
    args: [],
    log: true,
  });

  // Deploy ReputationOracle
  const reputationOracleDeployment = await deploy("ReputationOracle", {
    from: deployer,
    args: [],
    log: true,
  });

  // Collect all addresses with their constructor arguments for verification
  const deployedAddresses = {
    ERC20Mock: {
      address: erc20Deployment.address,
      args: ["DAOForge Governance Token", "DAOG", 18]
    },
    QuadraticVoting: {
      address: quadraticVotingDeployment.address,
      args: []
    },
    Treasury: {
      address: treasuryDeployment.address,
      args: []
    },
    Governor: {
      address: governorDeployment.address,
      args: []
    },
    Registry: {
      address: registryDeployment.address,
      args: [
        governorDeployment.address,
        treasuryDeployment.address,
        quadraticVotingDeployment.address
      ]
    },
    Delegation: {
      address: delegationDeployment.address,
      args: [
        erc20Deployment.address,
        10000,
        500
      ]
    },
    ProposalExecutor: {
      address: proposalExecutorDeployment.address,
      args: [
        registryDeployment.address,
        2000      ]
    },
    PriceFeed: {
      address: priceFeedDeployment.address,
      args: []
    },
    ReputationOracle: {
      address: reputationOracleDeployment.address,
      args: []
    }
  };

  // Save addresses to deployments/sepolia.json
  const deploymentsDir = path.join(__dirname, "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  const output = {
    governanceToken