#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{token, Address, Env, Vec, String};

fn create_token_contract<'a>(e: &Env, admin: &Address) -> (token::Client<'a>, token::StellarAssetClient<'a>) {
    let address = e.register_stellar_asset_contract(admin.clone());
    (token::Client::new(e, &address), token::StellarAssetClient::new(e, &address))
}

#[test]
fn test_multi_token_campaign() {
    let e = Env::default();
    e.mock_all_auths();

    let creator = Address::generate(&e);
    let contributor1 = Address::generate(&e);
    let contributor2 = Address::generate(&e);

    let contract_id = e.register_contract(None, StellarGoalVaultContract);
    let client = StellarGoalVaultContractClient::new(&e, &contract_id);

    let admin = Address::generate(&e);
    let (token1, token1_admin) = create_token_contract(&e, &admin);
    let (token2, token2_admin) = create_token_contract(&e, &admin);

    let accepted_tokens = Vec::from_array(&e, [token1.address.clone(), token2.address.clone()]);
    let target_amount = 1000;
    let deadline = e.ledger().timestamp() + 1000;
    let metadata = String::from_str(&e, "Test Campaign");

    let campaign_id = client.create_campaign(&creator, &accepted_tokens, &target_amount, &deadline, &metadata);

    // Initial check
    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.accepted_tokens, accepted_tokens);
    assert_eq!(campaign.pledged_amount, 0);

    // Contributor 1 pledges token 1
    let amount1 = 400;
    token1_admin.mint(&contributor1, &amount1);
    client.contribute(&campaign_id, &contributor1, &token1.address, &amount1);

    // Contributor 2 pledges token 2
    let amount2 = 600;
    token2_admin.mint(&contributor2, &amount2);
    client.contribute(&campaign_id, &contributor2, &token2.address, &amount2);

    // Check balances and total pledged
    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.pledged_amount, 1000); // 400 + 600
    assert_eq!(client.get_contribution(&campaign_id, &contributor1, &token1.address), 400);
    assert_eq!(client.get_contribution(&campaign_id, &contributor2, &token2.address), 600);
    assert_eq!(client.get_campaign_token_balance(&campaign_id, &token1.address), 400);
    assert_eq!(client.get_campaign_token_balance(&campaign_id, &token2.address), 600);

    // Fast forward to deadline
    e.ledger().with_mut(|li| {
        li.timestamp = deadline + 1;
    });

    // Claim funds
    client.claim(&campaign_id, &creator);

    // Verify creator received both tokens
    assert_eq!(token1.balance(&creator), 400);
    assert_eq!(token2.balance(&creator), 600);

    // Verify campaign marked as claimed
    let campaign = client.get_campaign(&campaign_id);
    assert!(campaign.claimed);
}

#[test]
fn test_multi_token_refund() {
    let e = Env::default();
    e.mock_all_auths();

    let creator = Address::generate(&e);
    let contributor = Address::generate(&e);

    let contract_id = e.register_contract(None, StellarGoalVaultContract);
    let client = StellarGoalVaultContractClient::new(&e, &contract_id);

    let admin = Address::generate(&e);
    let (token1, token1_admin) = create_token_contract(&e, &admin);
    let (token2, token2_admin) = create_token_contract(&e, &admin);

    let accepted_tokens = Vec::from_array(&e, [token1.address.clone(), token2.address.clone()]);
    let target_amount = 2000;
    let deadline = e.ledger().timestamp() + 1000;
    let metadata = String::from_str(&e, "Refund Test");

    let campaign_id = client.create_campaign(&creator, &accepted_tokens, &target_amount, &deadline, &metadata);

    // Contributor pledges both tokens
    token1_admin.mint(&contributor, &500);
    client.contribute(&campaign_id, &contributor, &token1.address, &500);
    token2_admin.mint(&contributor, &500);
    client.contribute(&campaign_id, &contributor, &token2.address, &500);

    // Total pledged is 1000, target is 2000. Campaign fails.
    e.ledger().with_mut(|li| {
        li.timestamp = deadline + 1;
    });

    // Refund
    client.refund(&campaign_id, &contributor);

    // Verify contributor got back both tokens
    assert_eq!(token1.balance(&contributor), 500);
    assert_eq!(token2.balance(&contributor), 500);

    // Verify campaign state
    let campaign = client.get_campaign(&campaign_id);
    assert_eq!(campaign.pledged_amount, 0);
}

#[test]
#[should_panic(expected = "token not accepted by this campaign")]
fn test_unaccepted_token() {
    let e = Env::default();
    e.mock_all_auths();

    let creator = Address::generate(&e);
    let contributor = Address::generate(&e);

    let contract_id = e.register_contract(None, StellarGoalVaultContract);
    let client = StellarGoalVaultContractClient::new(&e, &contract_id);

    let admin = Address::generate(&e);
    let (token1, _) = create_token_contract(&e, &admin);
    let (token2, token2_admin) = create_token_contract(&e, &admin);

    let accepted_tokens = Vec::from_array(&e, [token1.address.clone()]);
    let campaign_id = client.create_campaign(&creator, &accepted_tokens, &1000, &(e.ledger().timestamp() + 1000), &String::from_str(&e, "Test"));

    token2_admin.mint(&contributor, &500);
    client.contribute(&campaign_id, &contributor, &token2.address, &500);
}
