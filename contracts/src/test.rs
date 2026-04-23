#[cfg(test)]
mod tests {
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::StellarAssetClient,
        Address, Env, String,
    };

    use crate::{StellarGoalVaultContract, StellarGoalVaultContractClient};

    fn deploy_contract(env: &Env) -> StellarGoalVaultContractClient<'_> {
        let contract_id = env.register_contract(None, StellarGoalVaultContract);
        StellarGoalVaultContractClient::new(env, &contract_id)
    }

    fn deploy_token(env: &Env, admin: &Address, recipient: &Address, amount: i128) -> Address {
        let token_id = env.register_stellar_asset_contract(admin.clone());
        let asset_client = StellarAssetClient::new(env, &token_id);
        asset_client.mint(recipient, &amount);
        token_id
    }

    fn advance_time(env: &Env, seconds: u64) {
        env.ledger().with_mut(|info| {
            info.timestamp += seconds;
        });
    }

    #[test]
    fn test_claim_success() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 1_000;
        let deadline_offset: u64 = 100;
        let now = env.ledger().timestamp();
        let deadline = now + deadline_offset;

        let token = deploy_token(&env, &admin, &contributor, target);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &token,
            &target,
            &deadline,
            &String::from_str(&env, "test campaign"),
        );

        client.contribute(&campaign_id, &contributor, &target);
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &creator);

        let campaign = client.get_campaign(&campaign_id);
        assert!(campaign.claimed, "campaign should be marked claimed");
        assert_eq!(campaign.pledged_amount, target);
    }

    #[test]
    #[should_panic(expected = "creator mismatch")]
    fn test_claim_creator_mismatch() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let attacker = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 500;
        let deadline_offset: u64 = 50;
        let deadline = env.ledger().timestamp() + deadline_offset;

        let token = deploy_token(&env, &admin, &contributor, target);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &token,
            &target,
            &deadline,
            &String::from_str(&env, "mismatch test"),
        );

        client.contribute(&campaign_id, &contributor, &target);
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &attacker);
    }

    #[test]
    #[should_panic(expected = "campaign is still active")]
    fn test_claim_before_deadline() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 500;
        let deadline = env.ledger().timestamp() + 1_000;

        let token = deploy_token(&env, &admin, &contributor, target);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &token,
            &target,
            &deadline,
            &String::from_str(&env, "early claim test"),
        );

        client.contribute(&campaign_id, &contributor, &target);
        client.claim(&campaign_id, &creator);
    }

    #[test]
    #[should_panic(expected = "campaign is not funded")]
    fn test_claim_underfunded() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 1_000;
        let deadline_offset: u64 = 50;
        let deadline = env.ledger().timestamp() + deadline_offset;

        let token = deploy_token(&env, &admin, &contributor, target / 2);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &token,
            &target,
            &deadline,
            &String::from_str(&env, "underfunded test"),
        );

        client.contribute(&campaign_id, &contributor, &(target / 2));
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &creator);
    }

    #[test]
    #[should_panic(expected = "campaign already claimed")]
    fn test_claim_double_claim() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 200;
        let deadline_offset: u64 = 50;
        let deadline = env.ledger().timestamp() + deadline_offset;

        let token = deploy_token(&env, &admin, &contributor, target);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &token,
            &target,
            &deadline,
            &String::from_str(&env, "double claim test"),
        );

        client.contribute(&campaign_id, &contributor, &target);
        advance_time(&env, deadline_offset + 1);
        client.claim(&campaign_id, &creator);
        client.claim(&campaign_id, &creator);
    }

    // -------------------------------------------------------------------------
    // batch_refund: full batch — all contributors refunded
    // -------------------------------------------------------------------------
    #[test]
    fn test_batch_refund_full() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor1 = Address::generate(&env);
        let contributor2 = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 1_000;
        let deadline_offset: u64 = 100;
        let deadline = env.ledger().timestamp() + deadline_offset;

        let token_id = env.register_stellar_asset_contract(admin.clone());
        let asset_client = StellarAssetClient::new(&env, &token_id);
        asset_client.mint(&contributor1, &300_i128);
        asset_client.mint(&contributor2, &400_i128);

        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &token_id,
            &target,
            &deadline,
            &String::from_str(&env, "batch refund test"),
        );

        client.contribute(&campaign_id, &contributor1, &300_i128);
        client.contribute(&campaign_id, &contributor2, &400_i128);

        advance_time(&env, deadline_offset + 1);

        let contributors = soroban_sdk::vec![&env, contributor1.clone(), contributor2.clone()];
        client.batch_refund(&campaign_id, &contributors);

        assert_eq!(client.get_contribution(&campaign_id, &contributor1), 0);
        assert_eq!(client.get_contribution(&campaign_id, &contributor2), 0);

        let campaign = client.get_campaign(&campaign_id);
        assert_eq!(campaign.pledged_amount, 0);
    }

    // -------------------------------------------------------------------------
    // batch_refund: partial batch — already-refunded contributor is skipped
    // -------------------------------------------------------------------------
    #[test]
    fn test_batch_refund_skips_already_refunded() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor1 = Address::generate(&env);
        let contributor2 = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 1_000;
        let deadline_offset: u64 = 100;
        let deadline = env.ledger().timestamp() + deadline_offset;

        let token_id = env.register_stellar_asset_contract(admin.clone());
        let asset_client = StellarAssetClient::new(&env, &token_id);
        asset_client.mint(&contributor1, &300_i128);
        asset_client.mint(&contributor2, &400_i128);

        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &token_id,
            &target,
            &deadline,
            &String::from_str(&env, "skip refunded test"),
        );

        client.contribute(&campaign_id, &contributor1, &300_i128);
        client.contribute(&campaign_id, &contributor2, &400_i128);

        advance_time(&env, deadline_offset + 1);

        client.refund(&campaign_id, &contributor1);
        assert_eq!(client.get_contribution(&campaign_id, &contributor1), 0);

        let contributors = soroban_sdk::vec![&env, contributor1.clone(), contributor2.clone()];
        client.batch_refund(&campaign_id, &contributors);

        assert_eq!(client.get_contribution(&campaign_id, &contributor1), 0);
        assert_eq!(client.get_contribution(&campaign_id, &contributor2), 0);

        let campaign = client.get_campaign(&campaign_id);
        assert_eq!(campaign.pledged_amount, 0);
    }

    // -------------------------------------------------------------------------
    // batch_refund: panics if campaign is still active
    // -------------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "campaign is still active")]
    fn test_batch_refund_still_active() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 1_000;
        let deadline = env.ledger().timestamp() + 1_000;

        let token = deploy_token(&env, &admin, &contributor, 300);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &token,
            &target,
            &deadline,
            &String::from_str(&env, "active test"),
        );

        client.contribute(&campaign_id, &contributor, &300_i128);

        let contributors = soroban_sdk::vec![&env, contributor.clone()];
        client.batch_refund(&campaign_id, &contributors);
    }

    // -------------------------------------------------------------------------
    // batch_refund: panics if campaign is funded
    // -------------------------------------------------------------------------
    #[test]
    #[should_panic(expected = "funded campaigns cannot be refunded")]
    fn test_batch_refund_funded_campaign() {
        let env = Env::default();
        env.mock_all_auths();

        let creator = Address::generate(&env);
        let contributor = Address::generate(&env);
        let admin = Address::generate(&env);

        let target: i128 = 500;
        let deadline_offset: u64 = 50;
        let deadline = env.ledger().timestamp() + deadline_offset;

        let token = deploy_token(&env, &admin, &contributor, target);
        let client = deploy_contract(&env);

        let campaign_id = client.create_campaign(
            &creator,
            &token,
            &target,
            &deadline,
            &String::from_str(&env, "funded test"),
        );

        client.contribute(&campaign_id, &contributor, &target);
        advance_time(&env, deadline_offset + 1);

        let contributors = soroban_sdk::vec![&env, contributor.clone()];
        client.batch_refund(&campaign_id, &contributors);
    }
}
