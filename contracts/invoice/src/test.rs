#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events as _, MockAuth, MockAuthInvoke},
    token, Address, Env, Event, IntoVal,
};

struct Setup {
    admin: Address,
    merchant: Address,
    payer: Address,
    token: Address,
    contract_id: Address,
}

/// Fresh env with a USDC-like SAC token (payer pre-funded) and a deployed invoice
/// contract pinned to that token and an admin. All auths are mocked unless a test
/// narrows them with `mock_auths`.
fn setup(env: &Env) -> Setup {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let merchant = Address::generate(env);
    let payer = Address::generate(env);
    let token_admin = Address::generate(env);

    let sac = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = sac.address();
    token::StellarAssetClient::new(env, &token_address).mint(&payer, &1_000);

    let contract_id = env.register(InvoiceContract, (token_address.clone(), admin.clone()));
    Setup {
        admin,
        merchant,
        payer,
        token: token_address,
        contract_id,
    }
}

/// Authorization for exactly one `fn_name(args)` call on the invoice contract, signed by `signer`.
fn only_auth<'a>(
    signer: &'a Address,
    contract_id: &'a Address,
    fn_name: &'a str,
    args: soroban_sdk::Vec<soroban_sdk::Val>,
) -> MockAuth<'a> {
    MockAuth {
        address: signer,
        invoke: std::boxed::Box::leak(std::boxed::Box::new(MockAuthInvoke {
            contract: contract_id,
            fn_name,
            args,
            sub_invokes: &[],
        })),
    }
}

extern crate std;

#[test]
fn test_create() {
    let env = Env::default();
    let s = setup(&env);
    let client = InvoiceContractClient::new(&env, &s.contract_id);

    // Admin alone authorizes create — the merchant does not sign.
    let code = symbol_short!("INV1");
    let args = (s.merchant.clone(), code.clone(), 100_i128, 1000_u32).into_val(&env);
    client
        .mock_auths(&[only_auth(&s.admin, &s.contract_id, "create", args)])
        .create(&s.merchant, &code, &100, &1000);

    // Events only cover the most recent invocation, so assert before the next call.
    assert_eq!(
        env.events().all().filter_by_contract(&s.contract_id),
        [Created {
            code: code.clone(),
            merchant: s.merchant.clone(),
            amount: 100,
            deadline: 1000,
        }
        .to_xdr(&env, &s.contract_id)]
    );

    let inv = client.get(&code);
    assert_eq!(inv.merchant, s.merchant);
    assert_eq!(inv.code, code);
    assert_eq!(inv.amount, 100);
    assert_eq!(inv.deadline, 1000);
    assert_eq!(inv.status, Status::Pending);
    assert_eq!(inv.payer, None);

    // A create authorized by anyone other than the admin (here: the merchant) fails.
    let other = symbol_short!("INV1B");
    let args = (s.merchant.clone(), other.clone(), 100_i128, 1000_u32).into_val(&env);
    assert!(client
        .mock_auths(&[only_auth(&s.merchant, &s.contract_id, "create", args)])
        .try_create(&s.merchant, &other, &100, &1000)
        .is_err());
    assert!(client.try_get(&other).is_err());

    env.mock_all_auths();
    // A second create with the same code is rejected.
    assert!(client.try_create(&s.merchant, &code, &100, &1000).is_err());
    // amount must be positive.
    assert!(client
        .try_create(&s.merchant, &symbol_short!("BAD"), &0, &1000)
        .is_err());
}

#[test]
fn test_pay() {
    let env = Env::default();
    let s = setup(&env);
    let client = InvoiceContractClient::new(&env, &s.contract_id);
    let token = token::Client::new(&env, &s.token);

    let code = symbol_short!("INV2");
    client.create(&s.merchant, &code, &250, &1000);
    client.pay(&code, &s.payer);

    // The backend's contract rail matches on this event (the SAC transfer event is filtered out).
    assert_eq!(
        env.events().all().filter_by_contract(&s.contract_id),
        [Paid {
            code: code.clone(),
            payer: s.payer.clone(),
            merchant: s.merchant.clone(),
            amount: 250,
        }
        .to_xdr(&env, &s.contract_id)]
    );

    // USDC moved payer -> merchant.
    assert_eq!(token.balance(&s.payer), 750);
    assert_eq!(token.balance(&s.merchant), 250);

    let inv = client.get(&code);
    assert_eq!(inv.status, Status::Paid);
    assert_eq!(inv.payer, Some(s.payer.clone()));

    // Cannot pay again once paid.
    assert!(client.try_pay(&code, &s.payer).is_err());
}

#[test]
fn test_get() {
    let env = Env::default();
    let s = setup(&env);
    let client = InvoiceContractClient::new(&env, &s.contract_id);

    let code = symbol_short!("INV3");
    client.create(&s.merchant, &code, &42, &500);

    // Positive: returns the stored invoice verbatim.
    let inv = client.get(&code);
    assert_eq!(inv.amount, 42);
    assert_eq!(inv.deadline, 500);

    // Negative: an unknown code errors (NotFound).
    assert!(client.try_get(&symbol_short!("NOPE")).is_err());
}

#[test]
fn test_cancel() {
    let env = Env::default();
    let s = setup(&env);
    let client = InvoiceContractClient::new(&env, &s.contract_id);

    let code = symbol_short!("INV4");
    client.create(&s.merchant, &code, &50, &1000);

    // Only the admin can cancel — the merchant cannot.
    let args = (code.clone(),).into_val(&env);
    assert!(client
        .mock_auths(&[only_auth(&s.merchant, &s.contract_id, "cancel", args)])
        .try_cancel(&code)
        .is_err());
    assert_eq!(client.get(&code).status, Status::Pending);

    let args = (code.clone(),).into_val(&env);
    client
        .mock_auths(&[only_auth(&s.admin, &s.contract_id, "cancel", args)])
        .cancel(&code);

    assert_eq!(
        env.events().all().filter_by_contract(&s.contract_id),
        [Cancelled {
            code: code.clone(),
            merchant: s.merchant.clone(),
        }
        .to_xdr(&env, &s.contract_id)]
    );

    assert_eq!(client.get(&code).status, Status::Cancelled);
    // A cancelled invoice can no longer be paid.
    env.mock_all_auths();
    assert!(client.try_pay(&code, &s.payer).is_err());
}
