pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/**
 * @title PriceFeed
 * @dev Wraps Chainlink ETH/USD price feed and provides latest price with staleness checks */
contract PriceFeed {
    AggregatorV3Interface internal immutable priceFeed;
    uint256 internal constant MAX_STALENESS = 1 hours; // 1 hour staleness threshold

    /**
     * @dev Constructor sets the Chainlink ETH/USD feed address
     * @param _priceFeed Address of the ETH/USD Chainlink aggregator (Sepolia: 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419)
     */
    constructor(address _priceFeed) {
        require(_priceFeed != address(0), "PriceFeed: price feed is zero address");
        priceFeed = AggregatorV3Interface(_priceFeed);
    }

    /**
     * @dev Returns the latest ETH/USD price with 8 decimals
     * @return price_ Latest price in ETH/USD with 8 decimals (e.g., 1800.00 * 10^8 = 180000000000)
     * @revert PriceFeed: stale price if data is older than MAX_STALENESS
     * @revert PriceFeed: invalid round if round data is invalid
     */
    function latestPrice() external view returns (uint256 price_) {
        (uint80 roundID, int256 answer, , uint256 updatedAt, ) = priceFeed.latestRoundData();
        
        require(roundID > 0, "PriceFeed: invalid round");
        require(answer >= 0, "PriceFeed: negative price");
        require(block.timestamp - updatedAt <= MAX_STALENESS, "PriceFeed: stale price");
        
        return uint256(answer);
    }

    /**
     * @dev Returns the timestamp of the last update
     * @return updatedAt_ Timestamp of the last update in seconds
     */
    function lastUpdated() external view returns (uint256 updatedAt_) {
        (,,,, updatedAt_) = priceFeed.latestRoundData();
        return updatedAt_;
    }

    /**
     * @dev Returns the decimals of the price feed
     * @return decimals_ Number of decimals (should be 8 for ETH/USD)
     */
    function decimals() external view returns (uint8 decimals_) {
        decimals_ = priceFeed.decimals();
    }

    /**
     * @dev Returns the description of the price feed
     * @return description_ Description string (e.g., "ETH / USD")
     */
    function description() external view returns (string memory description_) {
        description_ = priceFeed.description();
    }
}