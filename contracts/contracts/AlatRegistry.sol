// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice QoreChain PQC Key Status precompile (0x…0A02 on the testnet).
interface IPqcKeyStatus {
    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven);
}

/// @title AlatRegistry
/// @notice Binds a chat account (stored only as a salted hash) to the QoreChain
/// account whose key answers for it.
///
/// Re-link protection lives here, not in the bot: once an account is linked, a
/// new key takes over only with the current owner's consent, or after a public
/// 7-day wait during which the current owner can cancel.
///
/// Every write is made by the Alat relayer and stores the hash of the
/// hybrid-signed (secp256k1 + ML-DSA-87) native-lane transaction it is based on,
/// so anyone can check what the relayer did. See docs/FINDINGS.md (F2, F3).
contract AlatRegistry {
    uint64 public constant CHANGE_DELAY = 7 days;
    uint8 public constant ML_DSA_87 = 1;

    struct Link {
        address owner;
        uint64 linkedAt;
        bytes32 evidence;
    }

    struct PendingChange {
        address newOwner; // address(0) means "remove the link"
        uint64 requestedAt;
        uint64 unlockAt; // 0 when nothing is pending
        bytes32 evidence;
    }

    address public immutable relayer;
    IPqcKeyStatus public immutable keyStatus;

    mapping(bytes32 => Link) private _links;
    mapping(bytes32 => PendingChange) private _pending;

    uint256 public linkedAccounts;
    uint256 public totalWrites;

    event Linked(bytes32 indexed account, address indexed owner, bytes32 evidence);
    event ChangeRequested(bytes32 indexed account, address indexed newOwner, uint64 unlockAt, bytes32 evidence);
    event ChangeCancelled(bytes32 indexed account, bytes32 evidence);
    event ChangeApplied(bytes32 indexed account, address indexed oldOwner, address indexed newOwner, bytes32 evidence);

    error NotRelayer();
    error AlreadyLinked();
    error NotLinked();
    error ChangePending();
    error NoChangePending();
    error TooEarly(uint64 unlockAt);
    error NoPqcKey(address owner);
    error SameOwner();
    error NoEvidence();

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    constructor(address relayer_, IPqcKeyStatus keyStatus_) {
        relayer = relayer_;
        keyStatus = keyStatus_;
    }

    // ---------------------------------------------------------------- reads

    function linkOf(bytes32 account)
        external
        view
        returns (address owner, uint64 linkedAt, bytes32 evidence)
    {
        Link storage l = _links[account];
        return (l.owner, l.linkedAt, l.evidence);
    }

    function pendingOf(bytes32 account)
        external
        view
        returns (address newOwner, uint64 requestedAt, uint64 unlockAt, bytes32 evidence)
    {
        PendingChange storage p = _pending[account];
        return (p.newOwner, p.requestedAt, p.unlockAt, p.evidence);
    }

    // --------------------------------------------------------------- writes

    /// @notice First link of an account. Takes effect at once.
    function link(bytes32 account, address owner, bytes32 evidence) external onlyRelayer {
        if (evidence == bytes32(0)) revert NoEvidence();
        if (_links[account].owner != address(0)) revert AlreadyLinked();
        _requirePqcKey(owner);
        _links[account] = Link(owner, uint64(block.timestamp), evidence);
        linkedAccounts++;
        totalWrites++;
        emit Linked(account, owner, evidence);
    }

    /// @notice A change asked for without the current owner's key (for example
    /// from the chat account alone). It waits CHANGE_DELAY and can be cancelled.
    function requestChange(bytes32 account, address newOwner, bytes32 evidence) external onlyRelayer {
        if (evidence == bytes32(0)) revert NoEvidence();
        Link storage l = _links[account];
        if (l.owner == address(0)) revert NotLinked();
        if (_pending[account].unlockAt != 0) revert ChangePending();
        if (newOwner == l.owner) revert SameOwner();
        if (newOwner != address(0)) _requirePqcKey(newOwner);
        uint64 unlockAt = uint64(block.timestamp) + CHANGE_DELAY;
        _pending[account] = PendingChange(newOwner, uint64(block.timestamp), unlockAt, evidence);
        totalWrites++;
        emit ChangeRequested(account, newOwner, unlockAt, evidence);
    }

    /// @notice The current owner cancels a pending change. `evidence` is their
    /// hybrid-signed cancel transaction.
    function cancelChange(bytes32 account, bytes32 evidence) external onlyRelayer {
        if (evidence == bytes32(0)) revert NoEvidence();
        if (_pending[account].unlockAt == 0) revert NoChangePending();
        delete _pending[account];
        totalWrites++;
        emit ChangeCancelled(account, evidence);
    }

    /// @notice The current owner moves (or removes) the link at once. `evidence`
    /// is their hybrid-signed consent transaction naming the new owner.
    function changeWithConsent(bytes32 account, address newOwner, bytes32 evidence) external onlyRelayer {
        if (evidence == bytes32(0)) revert NoEvidence();
        Link storage l = _links[account];
        if (l.owner == address(0)) revert NotLinked();
        if (newOwner == l.owner) revert SameOwner();
        if (newOwner != address(0)) _requirePqcKey(newOwner);
        delete _pending[account];
        _apply(account, newOwner, evidence);
    }

    /// @notice Applies a pending change once its wait is over. Anyone can call it.
    function finalizeChange(bytes32 account) external {
        PendingChange memory p = _pending[account];
        if (p.unlockAt == 0) revert NoChangePending();
        if (block.timestamp < p.unlockAt) revert TooEarly(p.unlockAt);
        delete _pending[account];
        _apply(account, p.newOwner, p.evidence);
    }

    // ------------------------------------------------------------- internal

    function _apply(bytes32 account, address newOwner, bytes32 evidence) private {
        address old = _links[account].owner;
        if (newOwner == address(0)) {
            delete _links[account];
            linkedAccounts--;
        } else {
            _links[account] = Link(newOwner, uint64(block.timestamp), evidence);
        }
        totalWrites++;
        emit ChangeApplied(account, old, newOwner, evidence);
    }

    function _requirePqcKey(address owner) private view {
        if (owner == address(0)) revert NoPqcKey(owner);
        (bool registered, uint8 algorithmId, , bool possessionProven) = keyStatus.pqcKeyStatus(owner);
        if (!registered || algorithmId != ML_DSA_87 || !possessionProven) revert NoPqcKey(owner);
    }
}
