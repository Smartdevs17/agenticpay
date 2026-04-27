# AgenticPay Smart Contract Documentation

The `AgenticPayContract` is a Soroban-based smart contract designed to facilitate secure payments between clients and freelancers using an escrow mechanism. It ensures funds are held securely and only released upon delivery and approval of work.

## Data Types

### `ProjectStatus` (Enum)
Represents the current lifecycle state of a project.

- `Created`: Project has been initialized but not yet funded.
- `Funded`: Escrow contains the required funds for the project.
- `InProgress`: Freelancer has started working on the project.
- `WorkSubmitted`: Freelancer has submitted the completion reference (e.g., GitHub repo).
- `Verified`: Submitted work has been automatically or manually verified.
- `Completed`: Work approved, funds released, and project finalized.
- `Disputed`: A party has raised a dispute regarding the work or payment.
- `Cancelled`: Project was terminated (e.g., due to deadline expiration or mutual agreement).

### `Project` (Struct)
Main data structure storing project details.

- `id`: Unique identifier (u64).
- `client`: Address of the project creator.
- `freelancer`: Address of the assigned freelancer.
- `amount`: Target budget for the project (i128).
- `deposited`: Current escrow balance (i128).
- `status`: Current state of the project (`ProjectStatus`).
- `github_repo`: Reference to the project workspace or submitted repository.
- `description`: Project description or scope of work.
- `created_at`: Unix timestamp of project creation.
- `deadline`: Unix timestamp for the project completion deadline (0 means no deadline).

### `ProjectInput` (Struct)
Helper struct for batch creation of projects.

- `freelancer`: Address of the freelancer to be assigned.
- `amount`: Project budget.
- `description`: Project description.
- `github_repo`: Workspace reference.

## Public Functions

### `initialize(env: Env, admin: Address)`
Initializes the contract with an administrator address. This address is used for dispute resolution and administrative metadata management.

- **Parameters**:
    - `admin`: The address to be set as the contract administrator.
- **Permissions**: Requires authorization from the provided `admin` address.
- **Returns**: None.

### `create_project(env: Env, client: Address, freelancer: Address, amount: i128, description: String, github_repo: String, deadline: u64) -> u64`
Creates a new project and returns its unique ID.

- **Parameters**:
    - `client`: The address of the client creating the project.
    - `freelancer`: The address of the freelancer assigned to the project.
    - `amount`: The budget amount for the project.
    - `description`: A brief description of the project.
    - `github_repo`: The GitHub repository associated with the project.
    - `deadline`: Unix timestamp for the project deadline.
- **Permissions**: Requires authorization from the `client` address.
- **Returns**: `u64` (The ID of the newly created project).

### `batch_create_projects(env: Env, client: Address, projects: Vec<ProjectInput>) -> Vec<u64>`
Creates multiple projects in a single optimized transaction.

- **Parameters**:
    - `client`: The address of the client creating the projects.
    - `projects`: A vector of `ProjectInput` structs.
- **Permissions**: Requires authorization from the `client` address.
- **Returns**: `Vec<u64>` (A list of IDs for the newly created projects).

### `fund_project(env: Env, project_id: u64, client: Address, amount: i128)`
Deposits funds into a project's escrow. If the total deposited matches or exceeds the project amount, the status transitions to `Funded`.

- **Parameters**:
    - `project_id`: The ID of the project to fund.
    - `client`: The address of the client funding the project.
    - `amount`: The amount to deposit.
- **Permissions**: Requires authorization from the `client` address. The project must be in `Created` status.
- **Returns**: None.

### `submit_work(env: Env, project_id: u64, freelancer: Address, github_repo: String)`
Submits work for a project, typically by providing a GitHub repository URL.

- **Parameters**:
    - `project_id`: The ID of the project.
    - `freelancer`: The address of the freelancer submitting the work.
    - `github_repo`: The URL of the repository containing the work.
- **Permissions**: Requires authorization from the assigned `freelancer`. The project must be in `Funded` or `InProgress` status.
- **Returns**: None.

### `approve_work(env: Env, project_id: u64, client: Address)`
Approves the submitted work, releases the escrowed funds to the freelancer, and marks the project as `Completed`.

- **Parameters**:
    - `project_id`: The ID of the project to approve.
    - `client`: The address of the client approving the work.
- **Permissions**: Requires authorization from the project `client`. The project must be in `WorkSubmitted` or `Verified` status.
- **Returns**: None.

### `raise_dispute(env: Env, project_id: u64, caller: Address)`
Raises a dispute on a project, shifting it to the `Disputed` status for administrative resolution.

- **Parameters**:
    - `project_id`: The ID of the project.
    - `caller`: The address of the party raising the dispute.
- **Permissions**: Requires authorization from either the `client` or the `freelancer`.
- **Returns**: None.

### `resolve_dispute(env: Env, project_id: u64, admin: Address, release_to_freelancer: bool)`
Resolves an active dispute, either releasing funds to the freelancer or refunding them to the client.

- **Parameters**:
    - `project_id`: The ID of the project.
    - `admin`: The administrator address.
    - `release_to_freelancer`: If true, funds are released to the freelancer; otherwise, they are refunded to the client.
- **Permissions**: Requires authorization from the stored `admin` address. Project must be in `Disputed` status.
- **Returns**: None.

### `check_deadline(env: Env, project_id: u64) -> bool`
Checks if a project has passed its deadline. If expired and not in a terminal state, the project is automatically cancelled and funds are marked for refund.

- **Parameters**:
    - `project_id`: The ID of the project to check.
- **Returns**: `bool` (True if the project was automatically cancelled).

### `get_project(env: Env, project_id: u64) -> Project`
Retrieves the details of a specific project.

- **Parameters**:
    - `project_id`: The ID of the project.
- **Returns**: The `Project` struct containing project state.

### `get_project_count(env: Env) -> u64`
Returns the total number of projects created.

- **Returns**: `u64`.

### `set_metadata(env: Env, admin: Address, key: String, value: String)`
Stores an arbitrary metadata key-value pair at the contract level.

- **Parameters**:
    - `admin`: The administrator address.
    - `key`: The metadata key.
    - `value`: The metadata value.
- **Permissions**: Requires administrator authorization.
- **Returns**: None.

### `get_metadata(env: Env, key: String) -> Option<String>`
Retrieves metadata associated with a specific key.

- **Parameters**:
    - `key`: The metadata key.
- **Returns**: `Option<String>` containing the value if found.

### `remove_metadata(env: Env, admin: Address, key: String)`
Deletes a metadata entry.

- **Parameters**:
    - `admin`: The administrator address.
    - `key`: The metadata key.
- **Permissions**: Requires administrator authorization.
- **Returns**: None.

### `upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>)`
Upgrades the contract logic to a new WASM binary while preserving all storage.

- **Parameters**:
    - `admin`: The administrator address.
    - `new_wasm_hash`: The SHA-256 hash of the new contract WASM.
- **Permissions**: Requires administrator authorization.
- **Returns**: None.

### `version(env: Env) -> u32`
Returns the current implementation version of the contract.

- **Returns**: `u32` (Current: 1).

## Workflow Examples

### Standard Flow
1. **Creation**: Client calls `create_project` to define scope and assignee.
2. **Funding**: Client calls `fund_project` to lock funds in escrow.
3. **Submission**: Freelancer calls `submit_work` with proof of delivery.
4. **Completion**: Client calls `approve_work` to release funds.

### Dispute Flow
1. **Conflict**: Either party calls `raise_dispute` if expectations are not met.
2. **Mediation**: Admin reviews and calls `resolve_dispute` to finalize payment or refund.

### Automatic Deadline Expiration
1. **Timeout**: If the `deadline` is set and passed, any user can trigger `check_deadline`.
2. **Cancellation**: The contract automatically cancels the project and authorizes a refund if the deadline is missed.
