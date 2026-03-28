import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

async function deployFullStack() {
  // Deploy ERC20 mock token
  const Token = await ethers.getContractFactory("ERC20Mock");
  const token = await Token.deploy("DAOForge Token", "DFT", 18);
  await token.waitForDeployment();

  // Deploy QuadraticVoting
  const QuadraticVoting = await ethers.getContractFactory("QuadraticVoting");
  const quadraticVoting = await QuadraticVoting.deploy();
  await quadraticVoting.waitForDeployment();

  // Deploy Registry with Governor, Treasury, QuadraticVoting addresses
  const Registry = await ethers.getContractFactory("Registry");
  const registry = await Registry.deploy(ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress);
  await registry.waitForDeployment();

  // Deploy Governor with registry address
  const Governor = await ethers.getContractFactory("Governor");
  const governor = await Governor.deploy(registry.target);
  await governor.waitForDeployment();

  // Deploy Delegation with token, lock duration, slash penalty  const Delegation = await ethers.getContractFactory("Delegation");
  const delegation = await Delegation.deploy(token.target, 1000000, 500);
  await delegation.waitForDeployment();

  // Deploy Treasury (ERC4626 mock)
  const Treasury = await ethers.getContractFactory("Treasury");
  const treasury = await Treasury.deploy(token.target);
  await treasury.waitForDeployment();

  // Deploy ProposalExecutor with registry and timelock
  const ProposalExecutor = await ethers.getContractFactory("ProposalExecutor");
  const executor = await ProposalExecutor.deploy(registry.target, 10000);
  await executor.waitForDeployment();

  // Deploy ReputationOracle (minimal)
  const ReputationOracle = await ethers.getContractFactory("ReputationOracle");
  const reputationOracle = await ReputationOracle.deploy();
  await reputationOracle.waitForDeployment();

  // Set up crosschain messenger mock (simple contract that emits an event)
  const Messenger = await ethers.getContractFactory("CrossChainMessenger");
  const messenger = await Messenger.deploy();
  await messenger.waitForDeployment();

  // Update registry to point to real addresses
  await registry.updateAddresses(
    governor.target,
    treasury.target,
    quadraticVoting.target
  );

  // Link contracts via setter functions (if any) -- assume they are public
  // Approve token for delegation and treasury usage
  await token.approve(delegation.target, ethers.MaxUint256);
  await token.approve(treasury.target, ethers.MaxUint256);
  await token.approve(governor.target, ethers.MaxUint256);
  await token.approve(executor.target, ethers.MaxUint256);

  return {
    token,
    quadraticVoting,
    registry,
    governor,
    delegation,
    treasury,
    executor,
    reputationOracle,
    messenger,
  };
}

describe("Governor Integration", function () {
  const QUADRATIC_MULTIPLIER = 1e6; // 1.0 for simplicity

  it("should calculate quadratic voting power correctly", async function () {
    const { token, delegation, quadraticVoting } = await loadFixture(deployFullStack);

    // Mint tokens to alice and bob
    const mintAmt = ethers.parseUnits("10000", 18);
    await token.mint(ethers.signerAddress("alice"), mintAmt);
    await token.mint(ethers.signerAddress("bob"), mintAmt);

    // Alice locks 5000 tokens for 1000 blocks
    await delegation.connect(ethers.signerAddress("alice")).lock(ethers.parseUnits("5000", 18));
    // Bob locks 2500 tokens for 1000 blocks    await delegation.connect(ethers.signerAddress("bob")).lock(ethers.parseUnits("2500", 18));

    // Set delegation multiplier for bob to 2 (delegating to alice)
    await delegation.connect(ethers.signerAddress("bob")).setMultiplier(2);

    // Query power via QuadraticVoting
    const alicePower = await quadraticVoting.getPower(ethers.signerAddress("alice"));
    const bobPower = await quadraticVoring.getPower(ethers.signerAddress("bob"));

    // Expected power = sqrt(balance * multiplier)
    // Alice: sqrt(5000 * 1)  70.71 -> scaled by 1e18 in contract
    // Bob: sqrt(2500 * 2) = sqrt(5000)  70.71
    // Use approximate comparison
    expect(alicePower).to.be.gt(0);
    expect(bobPower).to.be.gt(0);
    expect(alicePower).to.equal(bobPower);
  });

  it("should create a proposal and gather votes", async function () {
    const {
      token,
      delegation,
      governor,
      quadraticVoting,
      treasury,
    } = await loadFixture(deployFullStack);

    const mintAmt = ethers.parseUnits("5000", 18);
    await token.mint(ethers.signerAddress("alice"), mintAmt);
    await token.mint(ethers.signerAddress("bob"), mintAmt);

    // Lock and delegate    await delegation.connect(ethers.signerAddress("alice")).lock(mintAmt);
    await delegation.connect(ethers.signerAddress("bob")).lock(mintAmt);
    await delegation.connect(ethers.signerAddress("bob")).setMultiplier(1);

    // Simulate delegation multiplier update for testing power calc    await delegation.connect(ethers.signerAddress("bob")).setMultiplier(1);

    // Approve token for Governor (if needed)
    await token.approve(governor.target, mintAmt);

    // Create a proposal: send 1 wei to treasury (dummy)
    const targets = [treasury.target];
    const values = [ethers.parseUnits("1", 18)];
    const signatures = [""]; // placeholder
    const calldatas = ["0x"];
    const startBlock = await ethers.provider.getBlockNumber();
    const endBlock = startBlock + 1000;

    const tx = await governor
      .connect(ethers.signerAddress("alice"))
      .createProposal(targets, values, signatures, calldatas, startBlock, endBlock);
    const receipt = await tx.wait();
    const proposalId = receipt.logs[0].args.id;

    // Cast votes: Alice votes with full power, Bob votes against
    const alicePower = await quadraticVoting.getPower(ethers.signerAddress("alice"));
    await governor.connect(ethers.signerAddress("alice")).vote(proposalId, true, {
      value: 0,
      from: ethers.signerAddress("alice"),
      // attach power via msg.sender's delegation (handled by Governor logic)
    });

    // Bob votes against
    const bobPower = await quadraticVoting.getPower(ethers.signerAddress("bob"));
    await governor.connect(ethers.signerAddress("bob")).vote(proposalId, false, {
      value: 0,
      from: ethers.signerAddress("bob"),
    });

    // Advance time to endBlock
    const currentBlock = await ethers.provider.getBlockNumber();
    const blocksToAdvance = endBlock - currentBlock + 1;
    await ethers.provider.send("evm_mine", [blocksToAdvance]);

    // Check that proposal is executed only if quorum met
    const proposal = await governor.proposals(proposalId);
    expect(proposal.executed).to.be.false;

    // Simulate quorum failure (not enough total power)
    const totalPower = await quadraticVoting.totalPower();
    const quorumBP = await governor.quorumPercentage(); // assume set to 10000 (100%)
    const requiredPower = (quorumBP * totalPower) / 10000n;
    expect(totalPower).to.be.gt(requiredPower);
  });

  it("should only release treasury funds after successful proposal execution", async function () {
    const {
      token,
      treasury,
      governor,
      delegation,
      quadraticVoting,
    } = await loadFixture(deployFullStack);

    // Mint and lock tokens for a delegatee (agent)
    const agent = ethers.signerAddress("agent");
    const lockAmt = ethers.parseUnits("2000", 18);
    await delegation.connect(ethers.signerAddress("alice")).lock(lockAmt);
    await delegation.connect(ethers.signerAddress("alice")).delegate(agent);

    // Simulate agent performance proof acceptance (mock)
    const proof = "0x1234";
    await reputationOracle.submitProof(proof, "0x"); // minimal call

    // Create a proposal that transfers 100 tokens from treasury to agent
    const targets = [token.target];
    const values = [ethers.parseUnits("100", 18)];
    const signatures = [""];
    const calldatas = ["0x"];
    const startBlock = await ethers.provider.getBlockNumber();
    const endBlock = startBlock + 1000;

    const tx = await governor
      .connect(ethers.signerAddress("agent"))
      .createProposal(targets, values, signatures, calldatas, startBlock, endBlock);
    const receipt = await tx.wait();
    const proposalId = receipt.logs[0].args.id;

    // Vote in favor (agent votes with its delegated power)
    const agentPower = await quadraticVoting.getPower(agent);
    await governor.connect(agent).vote(proposalId, true);

    // Advance to endBlock
    const currentBlock = await ethers.provider.getBlockNumber();
    const blocksToMine = endBlock - currentBlock + 1;
    await ethers.provider.send("evm_mine", [blocksToMine]);

    // Execute proposal -- should succeed    await expect(governor.executeProposal(proposalId))
      .to.changeTokenBalances(
        token,
        [agent, treasury],
        [ethers.parseUnits("100", 18), ethers.parseUnits("-100", 18)]
      );

    // Verify treasury balance decreased
    const treasuryBal = await token.balanceOf(treasury.target);
    expect(treasuryBal).to.equal(ethers.parseUnits("9900", 18)); // assuming initial 10k
  });
});
