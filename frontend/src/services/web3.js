import Web3Modal from 'web3modal';
import { ethers } from 'ethers';

// Contract ABIs (minimal required for functionality)
const REGISTRY_ABI = [
  {
    "inputs": [],
    "name": "getGovernor",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getTreasury",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getQuadraticVoting",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getDelegation",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  }
];

const DELEGATION_ABI = [
  {
    "inputs": [{ "internalType": "uint256", "name": "amount", "type": "uint256" }],
    "name": "lock",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "delegatee", "type": "address" },
      { "internalType": "uint256", "name": "multiplier", "type": "uint256" }
    ],
    "name": "delegate",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "account", "type": "address" }],
    "name": "lockedBalance",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "account", "type": "address" }],
    "name": "delegationMultiplier",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "account", "type": "address" }],
    "name": "delegatee",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  }
];

const GOVERNOR_ABI = [
  {
    "inputs": [
      { "internalType": "address[]", "name": "targets", "type": "address[]" },
      { "internalType": "uint256[]", "name": "values", "type": "uint256[]" },
      { "internalType": "string[]", "name": "signatures", "type": "string[]" },
      { "internalType": "bytes[]", "name": "calldatas", "type": "bytes[]" }
    ],
    "name": "propose",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "proposalId", "type": "uint256" },
      { "internalType": "bool", "name": "support", "type": "bool" }
    ],
    "name": "vote",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "proposalId", "type": "uint256" }],
    "name": "state",
    "outputs": [{ "internalType": "uint8", "name": "", "type": "uint8" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "account", "type": "address" }],
    "name": "votingPower",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
];

const QUADRATIC_VOTING_ABI = [
  {
    "inputs": [{ "internalType": "address", "name": "account", "type": "address" }],
    "name": "getPower",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalPower",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
];

class Web3Service {
  constructor() {
    this.provider = null;
    this.signer = null;
    this.registryContract = null;
    this.delegationContract = null;
    this.governorContract = null;
    this.quadraticVotingContract = null;
    this.web3Modal = null;
    this.contractAddresses = {
      registry: '',
      governor: '',
      treasury: '',
      quadraticVoting: '',
      delegation: '',
      proposalExecutor: ''
    };
  }

  async init() {
    if (!this.web3Modal) {
      this.web3Modal = new Web3Modal({
        network: "sepolia",
        cacheProvider: true,
        providerOptions: {}
      });
    }
    
    try {
      const instance = await this.web3Modal.connect();
      this.provider = new ethers.BrowserProvider(instance);
      this.signer = await this.provider.getSigner();
      
      // Fetch contract addresses from API
      const addresses = await this.fetchContractAddresses();
      this.contractAddresses = addresses;
      
      // Initialize contracts
      this.registryContract = new ethers.Contract(
        addresses.registry,
        REGISTRY_ABI,
        this.signer
      );
      
      this.delegationContract = new ethers.Contract(
        addresses.delegation,
        DELEGATION_ABI,
        this.signer
      );
      
      this.governorContract = new ethers.Contract(
        addresses.governor,
        GOVERNOR_ABI,
        this.signer
      );
      
      this.quadraticVotingContract = new ethers.Contract(
        addresses.quadraticVoting,
        QUADRATIC_VOTING_ABI,
        this.signer
      );
      
      return true;
    } catch (error) {
      console.error('Failed to initialize web3:', error);
      throw error;
    }
  }

  async fetchContractAddresses() {
    try {
      const response = await fetch('/api/contracts');
      if (!response.ok) {
        throw new Error(`Failed to fetch contracts: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching contract addresses:', error);
      throw error;
    }
  }

  getSigner() {
    return this.signer;
  }

  getProvider() {
    return this.provider;
  }

  async getAccount() {
    if (!this.signer) {
      throw new Error('Wallet not connected');
    }
    return await this.signer.getAddress();
  }

  async lockTokens(amount) {
    if (!this.delegationContract) {
      throw new Error('Delegation contract not initialized');
    }
    const tx = await this.delegationContract.lock(amount);
    await tx.wait();
    return tx;
  }

  async delegateTo(delegatee, multiplier) {
    if (!this.delegationContract) {
      throw new Error('Delegation contract not initialized');
    }
    const tx = await this.delegationContract.delegate(delegatee, multiplier);
    await tx.wait();
    return tx;
  }

  async getDelegationInfo(account) {
    if (!this.delegationContract) {
      throw new Error('Delegation contract not initialized');
    }
    const [lockedBalance, multiplier, delegatee, lockTimestamp] = await Promise.all([
      this.delegationContract.lockedBalance(account),
      this.delegationContract.delegationMultiplier(account),
      this.delegationContract.delegatee(account),
      this.delegationContract.lockTimestamp(account)
    ]);
    return {
      lockedBalance: lockedBalance.to