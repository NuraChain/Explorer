// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// A deliberately small ERC-20: enough to emit real Transfer logs for the indexer to decode,
/// with no dependency on a token library. Seeding compiles this with solc, so the bytecode the
/// explorer indexes is genuinely produced from this source rather than pasted in.
contract NuraToken
{
    string public name = "Nura Test Token";
    string public symbol = "NURA";
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 value);

    constructor(uint256 supply)
    {
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
        emit Transfer(address(0), msg.sender, supply);
    }

    function transfer(address to, uint256 amount) external returns (bool)
    {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
}
