const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Treasury Integration Test", function () {
  let treasury, governor, reputationOracle, quadraticVoting, delegation, governanceToken;
  let owner, agent, voter1, voter2, proposer;
  let proposalId = 1;
  const VOTING_PERIOD = 50; // blocks
  const QUORUM_PERCENTAGE = 20; // 20% in basis points
  const TIMELOCK = 20; // blocks

  beforeEach(async function () {
    [owner, agent, voter1, voter2, proposer] = await ethers.getSigners();

    // Deploy Governance Token (ERC20)
    const GovernanceToken = await ethers.getContractFactory("ERC20Mock");
    governanceToken = await GovernanceToken.deploy("Governance Token", "GOV", 18);
    await governanceToken.deployed();

    // Mint tokens to voters
    await governanceToken.mint(voter1.address, ethers.utils.parseEther("1000"));
    await governanceToken.mint(voter2.address, ethers.utils.parseEther("1000"));
    await governanceToken.mint(agent.address, ethers.utils.parseEther("500"));

    // Deploy QuadraticVoting
    const QuadraticVoting = await ethers.getContractFactory("QuadraticVoting");
    quadraticVoting = await QuadraticVoting.deploy();
    await quadraticVoting.deployed();

    // Deploy Delegation
    const Delegation = await ethers.getContractFactory("Delegation");
    delegation = await Delegation.deploy(
      governanceToken.address,
      100, // lockDuration
      500  // slashPenalty (5%)
    );
    await delegation.deployed();

    // Deploy ReputationOracle
    const ReputationOracle = await ethers.getContractFactory("ReputationOracle");
    reputationOracle = await ReputationOracle.deploy();
    await reputationOracle.deployed();

    // Deploy Treasury (ERC4626 Vault)
    const Treasury = await ethers.getContractFactory("Treasury");
    treasury = await Treasury.deploy(
      governanceToken.address, // underlying token
      "DAO Treasury", 
      "dtGOV"
    );
    await treasury.deployed();

    // Deploy Governor
    const Governor = await ethers.getContractFactory("Governor");
    governor = await Governor.deploy(
      ethers.constants.AddressZero, // registry will be set later
      VOTING_PERIOD,
      QUORUM_PERCENTAGE,
      TIMELOCK
    );
    await governor.deployed();

    // Deploy ProposalExecutor
    const ProposalExecutor = await ethers.getContractFactory("ProposalExecutor");
    const proposalExecutor = await ProposalExecutor.deploy(
      ethers.constants.AddressZero, // registry will be set later      TIMELOCK
    );
    await proposalExecutor.deployed();

    // Deploy Registry and set addresses
    const Registry = await ethers.getContractFactory("Registry");
    const registry = await Registry.deploy(
      governor.address,
      treasury.address,
      quadraticVoting.address
    );
    await registry.deployed();

    // Update contracts with registry
    await governor.setRegistry(registry.address);
    await proposalExecutor.setRegistry(registry.address);

    // Approve treasury to spend tokens
    await governanceToken.approve(treasury.address, ethers.constants.MaxUint256);
  });

  it("Should allow deposits and track shares", async function () {
    const depositAmount = ethers.utils.parseEther("100");
    
    // Deposit tokens into treasury
    await treasury.deposit(depositAmount, owner.address);
    
    // Check total assets and shares
    const totalAssets = await treasury.totalAssets();
    expect(totalAssets).to.equal(depositAmount);
    
    const ownerShares = await treasury.balanceOf(owner.address);
    expect(ownerShares).to.equal(depositAmount); // 1:1 initially
    
    // Check share price
    const sharePrice = await treasury.convertToAssets(ethers.utils.parseEther("1"));
    expect(sharePrice).to.equal(ethers.utils.parseEther("1"));
  });

  it("Should only release funds after successful proposal execution", async function () {
    const depositAmount = ethers.utils.parseEther("500");
    const withdrawalAmount = ethers.utils.parseEther("100");
    
    // Deposit funds
    await treasury.deposit(depositAmount, owner.address);
        // Create a proposal to withdraw funds from treasury
    const targets = [treasury.address];
    const values = [0];
    const signatures = ["withdraw(uint256,address)"];
    const calldatas = [
      ethers.utils.defaultAbiCoder.encode(
        ["uint256", "address"],
        [withdrawalAmount, voter1.address]
      )
    ];
    
    // Propose
    await governor.connect(proposer).propose(
      targets,
      values,
      signatures,
      calldatas,
      "Withdraw funds from treasury"
    );
    
    // Vote yes with sufficient power
    await delegation.connect(voter1).lock(ethers.utils.parseEther("100"));
    await delegation.connect(voter1).delegate(agent.address, 2); // 2x multiplier
    
    // Agent votes (requires reputation proof)
    await reputationOracle.updateAgentScore(
      agent.address,
      ethers.utils.hexlify(ethers.utils.zeroPad(ethers.utils.defaultAbiCoder.encode(["uint256"], [80]), 32)) // 80 score
    );
    
    const agentPower = await quadraticVoting.getPower(agent.address);
    await governor.connect(agent).castVote(
      1,
      true, // support
      agentPower,
      ethers.utils.hexlify(ethers.utils.zeroPad(ethers.utils.defaultAbiCoder.encode(["uint256"], [80]), 32))
    );
    
    // Wait for voting period
    await ethers.provider.send("evm_mine", []);
    await ethers.provider.send("evm_increaseTime", [86400]); // 1 day
    await ethers.provider.send("evm_mine", []);
        // Execute proposal
    await governor.execute(1);
    
    // Check that funds were transferred
    const voter1BalanceBefore = await governanceToken.balanceOf(voter1.address);
    await treasury.connect(voter1).withdraw(withdrawalAmount, voter1.address, voter1.address);
    const voter1BalanceAfter = await governanceToken.balanceOf(voter1.address);
    
    expect(voter1BalanceAfter.sub(voter1BalanceBefore)).to.equal(withdrawalAmount);
    
    // Check treasury balance decreased
    const treasuryBalance = await governanceToken.balanceOf(treasury.address);
    expect(treasuryBalance).to.equal(depositAmount.sub(withdrawalAmount));
  });

  it("Should revert withdrawal attempt before proposal execution", async function () {
    const depositAmount = ethers.utils.parseEther("300");
    const withdrawalAmount = ethers.utils.parseEther("50");
    
    await treasury.deposit(depositAmount, owner.address);
        // Create proposal but don't execute
    const targets = [treasury.address];
    const values = [0];
    const signatures = ["withdraw(uint256,address)"];
    const calldatas = [
      ethers.utils.defaultAbiCoder.encode(
        ["uint256", "address"],
        [withdrawalAmount, voter1.address]
      )
    ];
    
    await governor.connect(proposer).propose(
      targets,
      values,
      signatures,
      calldatas,
      "Withdraw funds"
    );
    
    // Vote yes
    await delegation.connect(voter1).lock(ethers.utils.parseEther("100"));
    await delegation.connect(voter1).delegate(agent.address, 1);
    
    await reputationOracle.updateAgentScore(
      agent.address,
      ethers.utils.hexlify(ethers.utils.zeroPad(ethers.utils.defaultAbiCoder.encode(["uint256"], [70]), 32))
    );
    
    const agentPower = await quadraticVoting.getPower(agent.address);
    await governor.connect(agent).castVote(
      1,
      true,
      agentPower,
      ethers.utils.hexlify(ethers.utils.zeroPad(ethers.utils.defaultAbiCoder.encode(["uint256"], [70]), 32))
    );
    
    // Try to withdraw before execution - should fail
    await expect(
      treasury.connect(voter1).withdraw(withdrawalAmount, voter1.address, voter1.address)
    ).to.be.revertedWith("Treasury: withdrawal not authorized");
  });

  it("Should update shares correctly after deposit and withdrawal", async function () {
    const initialDeposit = ethers.utils.parseEther("200");
    await treasury.deposit(initialDeposit, owner.address);
    
    let shares = await treasury.balanceOf(owner.address);
    expect(shares).to.equal(initialDeposit);
    
    // Deposit more
    const secondDeposit = ethers.utils.parseEther("100");
    await treasury.deposit(secondDeposit, owner.address);
    
    shares = await treasury.balanceOf(owner.address);
    expect(shares).to.equal(initialDeposit.add(secondDeposit));
    
    // Withdraw half
    const withdrawAmount = ethers.utils.parseEther("150");
    await treasury.withdraw(withdrawalAmount, owner.address, owner.address);
    
    shares = await treasury.balanceOf(owner.address);
    expect(shares).to.equal(initialDeposit.add(secondDeposit).sub(withdrawalAmount));
  });
});