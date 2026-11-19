// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Test stand-in for the PQC Key Status precompile, used only by the
/// Hardhat tests (the simulated network has no QoreChain precompiles). The
/// testnet deployment points AlatRegistry at the real 0x…0A02.
contract MockPqcKeyStatus {
    struct Status {
        bool registered;
        uint8 algorithmId;
        bool possessionProven;
    }

    mapping(address => Status) public statusOf;

    function set(address account, bool registered, uint8 algorithmId, bool possessionProven) external {
        statusOf[account] = Status(registered, algorithmId, possessionProven);
    }

    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven)
    {
        Status memory s = statusOf[account];
        return (s.registered, s.algorithmId, s.registered ? new bytes(2592) : new bytes(0), s.possessionProven);
    }
}
