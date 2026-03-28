pragma solidity ^0.8.24;

contract Registry {
    address public immutable governor;
    address public immutable treasury;
    address public immutable quadraticVoting;

    event CoreAddressesSet(address indexed governor, address indexed treasury, address indexed quadraticVoting);

    constructor(
        address _governor,
        address _treasury,
        address _quadraticVoting
    ) {
        require(_governor != address(0), "Registry: governor is zero address");
        require(_treasury != address(0), "Registry: treasury is zero address");
        require(_quadraticVoting != address(0), "Registry: quadraticVoting is zero address");
        governor = _governor;
        treasury = _treasury;
        quadraticVoting = _quadraticVoting;
        emit CoreAddressesSet(_governor, _treasury, _quadraticVoting);
    }

    function getGovernor() external view returns (address) {
        require(governor != address(0), "Registry: governor not set");
        return governor;
    }

    function getTreasury() external view returns (address) {
        require(treasury != address(0), "Registry: treasury not set");
        return treasury;
    }

    function getQuadraticVoting() external view returns (address) {
        require(quadraticVoting != address(0), "Registry: quadraticVoting not set");
        return quadraticVoting;
    }
}