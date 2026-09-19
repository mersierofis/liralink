#![no_std]
//! LiraLink invoice contract.
//!
//! Records TRY payment links as on-chain invoices so a payer can settle *through*
//! the contract using the USDC Stellar Asset Contract (SAC), as an alternative to
//! the classic memo rail. One invoice per `code` (the same 8-char link code used by
//! the memo rail). See docs/00-PROJECT.md §7.
//!
//! Authorization: `create` and `cancel` require the **admin** (the LiraLink platform
//! account, pinned at deploy). `merchant` is only the payout address that `pay`
//! transfers to — merchants never sign anything (custody model, README).
//!
//! Events (the backend polls RPC `getEvents` for these; first topic is the event name,
//! second is the invoice code):
//! - `["created", code]` → `{ merchant, amount, deadline }`
//! - `["paid", code]` → `{ payer, merchant, amount }`
//! - `["cancelled", code]` → `{ merchant }`
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, Env, Symbol,
};

const DAY_IN_LEDGERS: u32 = 17_280; // ~5 s ledgers
const INSTANCE_BUMP: u32 = 30 * DAY_IN_LEDGERS;
const INSTANCE_THRESHOLD: u32 = INSTANCE_BUMP - DAY_IN_LEDGERS;
// Invoices stay readable this long after their deadline (or after being paid/cancelled).
const INVOICE_GRACE: u32 = 30 * DAY_IN_LEDGERS;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyExists = 1,
    NotFound = 2,
    NotPending = 3,
    Expired = 4,
    InvalidAmount = 5,
}

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Pending = 0,
    Paid = 1,
    Cancelled = 2,
}

#[contracttype]
#[derive(Clone)]
pub struct Invoice {
    pub merchant: Address, // payout address only — never asked to authorize
    pub code: Symbol,
    pub amount: i128,
    pub deadline: u32, // ledger sequence after which the invoice can no longer be paid
    pub status: Status,
    pub payer: Option<Address>,
}

#[contracttype]
pub enum DataKey {
    Token,           // instance: the USDC SAC address that `pay` transfers
    Admin,           // instance: the platform account allowed to create/cancel invoices
    Invoice(Symbol), // persistent: one invoice per code
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Created {
    #[topic]
    pub code: Symbol,
    pub merchant: Address,
    pub amount: i128,
    pub deadline: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Paid {
    #[topic]
    pub code: Symbol,
    pub payer: Address,
    pub merchant: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Cancelled {
    #[topic]
    pub code: Symbol,
    pub merchant: Address,
}

fn bump_instance(env: &Env) {
    let max = env.storage().max_ttl();
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_THRESHOLD.min(max), INSTANCE_BUMP.min(max));
}

/// Keep an invoice entry alive until `deadline + INVOICE_GRACE` (capped at the network max),
/// so a pending invoice can never be archived before it expires.
fn bump_invoice(env: &Env, key: &DataKey, deadline: u32) {
    let live_for = deadline
        .saturating_sub(env.ledger().sequence())
        .saturating_add(INVOICE_GRACE)
        .min(env.storage().max_ttl());
    env.storage().persistent().extend_ttl(key, live_for, live_for);
}

fn require_admin(env: &Env) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();
}

#[contract]
pub struct InvoiceContract;

#[contractimpl]
impl InvoiceContract {
    /// Deploy-time: pin the token (USDC Stellar Asset Contract address) that `pay` transfers
    /// and the admin (platform account) that may create and cancel invoices.
    pub fn __constructor(env: Env, token: Address, admin: Address) {
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Admin, &admin);
        bump_instance(&env);
    }

    /// Admin records an invoice payable to `merchant`. Fails if `code` already exists or
    /// `amount <= 0`.
    pub fn create(
        env: Env,
        merchant: Address,
        code: Symbol,
        amount: i128,
        deadline: u32,
    ) -> Result<(), Error> {
        require_admin(&env);
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let key = DataKey::Invoice(code.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::AlreadyExists);
        }
        env.storage().persistent().set(
            &key,
            &Invoice {
                merchant: merchant.clone(),
                code: code.clone(),
                amount,
                deadline,
                status: Status::Pending,
                payer: None,
            },
        );
        bump_invoice(&env, &key, deadline);
        bump_instance(&env);

        Created {
            code,
            merchant,
            amount,
            deadline,
        }
        .publish(&env);
        Ok(())
    }

    /// Payer settles a pending, unexpired invoice: transfers `amount` of the pinned
    /// token payer -> merchant (authorized by the payer), then marks it Paid.
    pub fn pay(env: Env, code: Symbol, payer: Address) -> Result<(), Error> {
        payer.require_auth();
        let key = DataKey::Invoice(code.clone());
        let mut invoice: Invoice =
            env.storage().persistent().get(&key).ok_or(Error::NotFound)?;
        if invoice.status != Status::Pending {
            return Err(Error::NotPending);
        }
        if env.ledger().sequence() > invoice.deadline {
            return Err(Error::Expired);
        }

        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        token::Client::new(&env, &token).transfer(&payer, &invoice.merchant, &invoice.amount);

        invoice.status = Status::Paid;
        invoice.payer = Some(payer.clone());
        env.storage().persistent().set(&key, &invoice);
        bump_invoice(&env, &key, env.ledger().sequence());
        bump_instance(&env);

        Paid {
            code,
            payer,
            merchant: invoice.merchant,
            amount: invoice.amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Read an invoice. Panics with `NotFound` if the code is unknown.
    pub fn get(env: Env, code: Symbol) -> Invoice {
        env.storage()
            .persistent()
            .get(&DataKey::Invoice(code))
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotFound))
    }

    /// Admin cancels a still-pending invoice.
    pub fn cancel(env: Env, code: Symbol) -> Result<(), Error> {
        require_admin(&env);
        let key = DataKey::Invoice(code.clone());
        let mut invoice: Invoice =
            env.storage().persistent().get(&key).ok_or(Error::NotFound)?;
        if invoice.status != Status::Pending {
            return Err(Error::NotPending);
        }
        invoice.status = Status::Cancelled;
        env.storage().persistent().set(&key, &invoice);
        bump_invoice(&env, &key, env.ledger().sequence());

        Cancelled {
            code,
            merchant: invoice.merchant,
        }
        .publish(&env);
        Ok(())
    }
}

mod test;
