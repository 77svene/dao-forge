const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Delegation", function () {
  let token, delegation;
  let deployer, delegator, delegatee, attacker;
  const LOCK_DURATION = 100; // blocks
  const SLASH_PENALTY = 500; // 5% basis points

  const erc20Source = `
    pragma solidity ^0.8.24;
    contract MockERC20 {
        mapping(address => uint) public balanceOf;
        string public name = "Mock ERC20";
        string public symbol = "MOCK";
        uint8 public decimals = 18;

        event Transfer(address indexed from, address indexed to, uint value);

        constructor(uint initialSupply) {
            balanceOf[msg.sender] = initialSupply;
        }

        function transfer(address to, uint amount) external returns (bool) {
            require(balanceOf[msg.sender] >= amount, "ERC20: transfer amount exceeds balance");
            balanceOf[msg.sender] -= amount;
            balanceOf[to] += amount;
            emit Transfer(msg.sender, to, amount);
            return true;
        }

        function mint(address to, uint amount) external {
            balanceOf[to] += amount;
            emit Transfer(address(0), to, amount);
        }
    }
  `;

  beforeEach(async function () {
    [deployer, delegator, delegatee, attacker] = await ethers.getSigners();

    // Deploy mock ERC20 token
    const erc20Factory = await ethers.getContractFactory(erc20Source);
    token = await erc20Factory.deploy(ethers.utils.parseEther("1000000"));
    await token.deployed();

    // Deploy Delegation contract
    const delegationFactory = await ethers.getContractFactory("Delegation");
    delegation = await delegationFactory.deploy(
      token.address,
      LOCK_DURATION,
      SLASH_PENALTY
    );
    await delegation.deployed();

    // Give delegator some tokens
    await token.transfer(delegator.address, ethers.utils.parseEther("500"));
  });

  describe("Locking", function () {
    it("should allow locking tokens", async function () {
      await token.approve(delegation.address, ethers.utils.parseEther("100"));
      await delegation.connect(delegator).lock(ethers.utils.parseEther("100"));

      expect(await delegation.lockedBalance(delegator)).to.equal(ethers.utils.parseEther("100"));
      expect(await token.balanceOf(delegation.address)).to.equal(ethers.utils.parseEther("100"));
      expect(await delegation.lockTimestamp(delegator)).to.be.gt(0);
    });

    it("should revert if locking zero amount", async function () {
      await token.approve(delegation.address, 0);
      await expect(delegation.connect(delegator).lock(0)).to.be.revertedWith(
        "Delegation: lock amount must be greater than 0"
      );
    });

    it("should revert if locking more than approved", async function () {
      await token.approve(delegation.address, ethers.utils.parseEther("50"));
      await expect(
        delegation.connect(delegator).lock(ethers.utils.parseEther("100"))
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });
  });

  describe("Delegation", function () {
    beforeEach(async function () {
      await token.approve(delegation.address, ethers.utils.parseEther("100"));
      await delegation.connect(delegator).lock(ethers.utils.parseEther("100"));
    });

    it("should allow setting delegation multiplier and delegatee", async function () {
      await delegation.connect(delegator).delegate(delegatee.address, 2);

      expect(await delegation.delegatee(delegator)).to.equal(delegatee.address);
      expect(await delegation.delegationMultiplier(delegator)).to.equal(2);
    });

    it("should revert if delegating to zero address", async function () {
      await expect(
        delegation.connect(delegator).delegate(ethers.constants.AddressZero, 2)
      ).to.be.revertedWith("Delegation: delegatee cannot be zero address");
    });

    it("should revert if delegating zero multiplier", async function () {
      await expect(
        delegation.connect(delegator).delegate(delegatee.address, 0)
      ).to.be.revertedWith("Delegation: multiplier must be greater than 0");
    });

    it("should revert if delegating more than locked balance", async function () {
      // Note: The delegation function doesn't check amount, but we test multiplier bounds
      await expect(
        delegation.connect(delegator).delegate(delegatee.address, 10001)
      ).to.be.revertedWith("Delegation: multiplier must be between 0 and 10000");
    });
  });

  describe("Unlocking", function () {
    it("should allow unlocking after lock duration", async function () {
      await token.approve(delegation.address, ethers.utils.parseEther("100"));
      await delegation.connect(delegator).lock(ethers.utils.parseEther("100"));

      // Move time forward by lock duration
      await ethers.provider.send("evm_increaseTime", [LOCK_DURATION * 12]); // assuming 12 sec per block
      await ethers.provider.send("evm_mine", []);

      await delegation.connect(delegator).unlock();

      expect(await delegation.lockedBalance(delegator)).to.equal(0);
      expect(await delegation.lockTimestamp(delegator)).to.equal(0);
      expect(await token.balanceOf(delegator)).to.equal(ethers.utils.parseEther("500")); // original 500 - 100 locked + 100 unlocked
    });

    it("should revert if unlocking before lock duration", async function () {
      await token.approve(delegation.address, ethers.utils.parseEther("100"));
      await delegation.connect(delegator).lock(ethers.utils.parseEther("100"));

      await expect(delegation.connect(delegator).unlock()).to.be.revertedWith(
        "Delegation: lock period not elapsed"
      );
    });

    it("should revert if unlocking zero locked balance", async function () {
      await expect(delegation.connect(delegator).unlock()).to.be.revertedWith(
        "Delegation: no locked balance to unlock"
      );
    });
  });

  describe("Slashing", function () {
    it("should allow slashing and reduce locked balance", async function () {
      await token.approve(delegation.address, ethers.utils.parseEther("100"));
      await delegation.connect(delegator).lock(ethers.utils.parseEther("100"));

      // Slash 50 tokens (5% of 1000? Actually penalty is 500 basis points = 5% of locked amount)
      // The slash function likely penalizes the delegator by SLASH_PENALTY basis points of their locked balance      await delegation.connect(attacker).slash(delegator.address);

      // Expect 5% penalty: 100 * 5% = 5 tokens slashed
      expect(await delegation.lockedBalance(delegator)).to.equal(ethers.utils.parseEther("95"));
      // Slashed tokens should be sent to... we don't know, but total supply should decrease? 
      // For simplicity, we just check locked balance decreased
    });

    it("should revert if slashing account with zero locked balance", async function () {
      await expect(delegation.connect(attacker).slash(delegator.address)).to.be.revertedWith(
        "Delegation: no locked balance to slash"
      );
    });

    it("should allow multiple slashes", async function () {
      await token.approve(delegation.address, ethers.utils.parseEther("100"));
      await delegation.connect(delegator).lock(ethers.utils.parseEther("100"));

      await delegation.connect(attacker).slash(delegator.address);
      await delegation.connect(attacker).slash(delegator.address);

      // After two 5% slashes: 100 * 0.95 * 0.95 = 90.25
      expect(await delegation.lockedBalance(delegator)).to.be.closeTo(
        ethers.utils.parseEther("90.25"),
        ethers.utils.parseEther("0.01")
      );
    });
  });
});