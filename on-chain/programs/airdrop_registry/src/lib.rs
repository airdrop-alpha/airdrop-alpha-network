use anchor_lang::prelude::*;

declare_id!("38CFzCb11EneZMQujTVZqJmXU7mXLxMg9fsS9hSZgnsC");

/// AirdropAlpha Registry Program
/// - Safety analysis reports on-chain
/// - User subscription management (SOL payments for MVP)
/// - Tiered access control
#[program]
pub mod airdrop_registry {
    use super::*;

    // ========================================================================
    // Registry & Safety Reports
    // ========================================================================

    /// Initialize a new registry for an authority.
    pub fn initialize_registry(ctx: Context<InitializeRegistry>) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        registry.authority = ctx.accounts.authority.key();
        registry.total_reports = 0;
        registry.bump = ctx.bumps.registry;

        msg!("Registry initialized for authority: {}", ctx.accounts.authority.key());
        Ok(())
    }

    /// Submit a new safety analysis report for a token.
    pub fn submit_report(
        ctx: Context<SubmitReport>,
        protocol_name: String,
        risk_score: u8,
        risk_level: u8,
        flags_count: u8,
    ) -> Result<()> {
        require!(risk_score <= 100, ErrorCode::InvalidRiskScore);
        require!(risk_level <= 2, ErrorCode::InvalidRiskLevel);
        require!(protocol_name.len() <= 32, ErrorCode::ProtocolNameTooLong);

        let report = &mut ctx.accounts.safety_report;
        report.authority = ctx.accounts.authority.key();
        report.token_mint = ctx.accounts.token_mint.key();
        report.risk_score = risk_score;
        report.risk_level = risk_level;
        report.flags_count = flags_count;
        report.protocol_name = protocol_name.clone();
        report.timestamp = Clock::get()?.unix_timestamp;
        report.bump = ctx.bumps.safety_report;

        let registry = &mut ctx.accounts.registry;
        registry.total_reports = registry.total_reports.checked_add(1).unwrap();

        msg!("Safety report submitted: {} | score: {} | level: {} | flags: {}",
            protocol_name, risk_score, risk_level, flags_count);
        Ok(())
    }

    /// Update an existing safety report.
    pub fn update_report(
        ctx: Context<UpdateReport>,
        protocol_name: String,
        risk_score: u8,
        risk_level: u8,
        flags_count: u8,
    ) -> Result<()> {
        require!(risk_score <= 100, ErrorCode::InvalidRiskScore);
        require!(risk_level <= 2, ErrorCode::InvalidRiskLevel);
        require!(protocol_name.len() <= 32, ErrorCode::ProtocolNameTooLong);

        let report = &mut ctx.accounts.safety_report;
        report.risk_score = risk_score;
        report.risk_level = risk_level;
        report.flags_count = flags_count;
        report.protocol_name = protocol_name.clone();
        report.timestamp = Clock::get()?.unix_timestamp;

        msg!("Safety report updated: {} | score: {}", protocol_name, risk_score);
        Ok(())
    }

    // ========================================================================
    // Subscription Management (SOL payments for MVP)
    // ========================================================================

    /// Initialize the subscription config (admin only, once).
    pub fn initialize_subscription_config(
        ctx: Context<InitializeSubscriptionConfig>,
        basic_price_lamports: u64,
        pro_price_lamports: u64,
        alpha_price_lamports: u64,
        subscription_duration: i64, // Duration in seconds
    ) -> Result<()> {
        let config = &mut ctx.accounts.subscription_config;
        config.admin = ctx.accounts.admin.key();
        config.treasury = ctx.accounts.treasury.key();
        config.basic_price = basic_price_lamports;
        config.pro_price = pro_price_lamports;
        config.alpha_price = alpha_price_lamports;
        config.subscription_duration = subscription_duration;
        config.total_subscribers = 0;
        config.total_revenue = 0;
        config.bump = ctx.bumps.subscription_config;

        msg!("Subscription config initialized. Treasury: {}", ctx.accounts.treasury.key());
        Ok(())
    }

    /// Subscribe with SOL payment.
    /// Tier: 1 = Basic, 2 = Pro, 3 = Alpha
    pub fn subscribe(ctx: Context<Subscribe>, tier: u8) -> Result<()> {
        require!(tier >= 1 && tier <= 3, ErrorCode::InvalidTier);

        let config = &ctx.accounts.subscription_config;
        let price = match tier {
            1 => config.basic_price,
            2 => config.pro_price,
            3 => config.alpha_price,
            _ => return Err(ErrorCode::InvalidTier.into()),
        };

        // Transfer SOL from user to treasury
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.user.key(),
            &ctx.accounts.treasury.key(),
            price,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.treasury.to_account_info(),
            ],
        )?;

        // Create subscription
        let subscription = &mut ctx.accounts.subscription;
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;
        let new_expiry = now.checked_add(config.subscription_duration).unwrap();

        subscription.user = ctx.accounts.user.key();
        subscription.tier = tier;
        subscription.expires_at = new_expiry;
        subscription.created_at = now;
        subscription.total_paid = price;
        subscription.bump = ctx.bumps.subscription;

        // Update config stats
        let config = &mut ctx.accounts.subscription_config;
        config.total_subscribers = config.total_subscribers.checked_add(1).unwrap();
        config.total_revenue = config.total_revenue.checked_add(price).unwrap();

        msg!("Subscription created: user={} tier={} expires={}", 
            ctx.accounts.user.key(), tier, new_expiry);
        Ok(())
    }

    /// Renew or upgrade an existing subscription.
    pub fn renew_subscription(ctx: Context<RenewSubscription>, tier: u8) -> Result<()> {
        require!(tier >= 1 && tier <= 3, ErrorCode::InvalidTier);

        let config = &ctx.accounts.subscription_config;
        let price = match tier {
            1 => config.basic_price,
            2 => config.pro_price,
            3 => config.alpha_price,
            _ => return Err(ErrorCode::InvalidTier.into()),
        };

        // Transfer SOL from user to treasury
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.user.key(),
            &ctx.accounts.treasury.key(),
            price,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.treasury.to_account_info(),
            ],
        )?;

        // Update subscription
        let subscription = &mut ctx.accounts.subscription;
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;

        let base_time = if subscription.expires_at > now {
            subscription.expires_at
        } else {
            now
        };
        let new_expiry = base_time.checked_add(config.subscription_duration).unwrap();

        subscription.tier = tier;
        subscription.expires_at = new_expiry;
        subscription.total_paid = subscription.total_paid.checked_add(price).unwrap();

        // Update config stats
        let config = &mut ctx.accounts.subscription_config;
        config.total_revenue = config.total_revenue.checked_add(price).unwrap();

        msg!("Subscription renewed: user={} tier={} expires={}", 
            subscription.user, tier, new_expiry);
        Ok(())
    }

    /// Verify subscription status.
    pub fn verify_subscription(ctx: Context<VerifySubscription>, required_tier: u8) -> Result<()> {
        let subscription = &ctx.accounts.subscription;
        let clock = Clock::get()?;
        
        let is_active = subscription.expires_at > clock.unix_timestamp;
        let has_tier = subscription.tier >= required_tier;
        let verified = is_active && has_tier;

        msg!("Subscription verification: user={} tier={} active={} verified={}",
            subscription.user, subscription.tier, is_active, verified);
        
        require!(verified, ErrorCode::InsufficientSubscription);
        Ok(())
    }

    /// Admin: Update subscription pricing.
    pub fn update_pricing(
        ctx: Context<UpdatePricing>,
        basic_price: u64,
        pro_price: u64,
        alpha_price: u64,
    ) -> Result<()> {
        let config = &mut ctx.accounts.subscription_config;
        config.basic_price = basic_price;
        config.pro_price = pro_price;
        config.alpha_price = alpha_price;

        msg!("Pricing updated: basic={} pro={} alpha={}", basic_price, pro_price, alpha_price);
        Ok(())
    }
}

// ============================================================================
// Account Contexts - Registry
// ============================================================================

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Registry::INIT_SPACE,
        seeds = [b"registry", authority.key().as_ref()],
        bump
    )]
    pub registry: Account<'info, Registry>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitReport<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + SafetyReport::INIT_SPACE,
        seeds = [b"safety_report", token_mint.key().as_ref(), authority.key().as_ref()],
        bump
    )]
    pub safety_report: Account<'info, SafetyReport>,

    #[account(
        mut,
        seeds = [b"registry", authority.key().as_ref()],
        bump = registry.bump,
        has_one = authority
    )]
    pub registry: Account<'info, Registry>,

    /// CHECK: Token mint address used as seed.
    pub token_mint: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateReport<'info> {
    #[account(
        mut,
        seeds = [b"safety_report", safety_report.token_mint.as_ref(), authority.key().as_ref()],
        bump = safety_report.bump,
        has_one = authority
    )]
    pub safety_report: Account<'info, SafetyReport>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

// ============================================================================
// Account Contexts - Subscriptions
// ============================================================================

#[derive(Accounts)]
pub struct InitializeSubscriptionConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + SubscriptionConfig::INIT_SPACE,
        seeds = [b"subscription_config"],
        bump
    )]
    pub subscription_config: Account<'info, SubscriptionConfig>,

    /// CHECK: Treasury account to receive SOL payments.
    #[account(mut)]
    pub treasury: AccountInfo<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Subscribe<'info> {
    #[account(
        init,
        payer = user,
        space = 8 + Subscription::INIT_SPACE,
        seeds = [b"subscription", user.key().as_ref()],
        bump
    )]
    pub subscription: Account<'info, Subscription>,

    #[account(
        mut,
        seeds = [b"subscription_config"],
        bump = subscription_config.bump
    )]
    pub subscription_config: Account<'info, SubscriptionConfig>,

    /// CHECK: Treasury to receive payment.
    #[account(
        mut,
        constraint = treasury.key() == subscription_config.treasury @ ErrorCode::InvalidTreasury
    )]
    pub treasury: AccountInfo<'info>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RenewSubscription<'info> {
    #[account(
        mut,
        seeds = [b"subscription", user.key().as_ref()],
        bump = subscription.bump,
        has_one = user @ ErrorCode::Unauthorized
    )]
    pub subscription: Account<'info, Subscription>,

    #[account(
        mut,
        seeds = [b"subscription_config"],
        bump = subscription_config.bump
    )]
    pub subscription_config: Account<'info, SubscriptionConfig>,

    /// CHECK: Treasury to receive payment.
    #[account(
        mut,
        constraint = treasury.key() == subscription_config.treasury @ ErrorCode::InvalidTreasury
    )]
    pub treasury: AccountInfo<'info>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VerifySubscription<'info> {
    #[account(
        seeds = [b"subscription", subscription.user.as_ref()],
        bump = subscription.bump
    )]
    pub subscription: Account<'info, Subscription>,
}

#[derive(Accounts)]
pub struct UpdatePricing<'info> {
    #[account(
        mut,
        seeds = [b"subscription_config"],
        bump = subscription_config.bump,
        has_one = admin @ ErrorCode::Unauthorized
    )]
    pub subscription_config: Account<'info, SubscriptionConfig>,

    pub admin: Signer<'info>,
}

// ============================================================================
// Account Structs - Registry
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct SafetyReport {
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub risk_score: u8,       // 0-100 (higher = safer)
    pub risk_level: u8,       // 0=HIGH, 1=MEDIUM, 2=LOW
    pub flags_count: u8,
    #[max_len(32)]
    pub protocol_name: String,
    pub timestamp: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Registry {
    pub authority: Pubkey,
    pub total_reports: u64,
    pub bump: u8,
}

// ============================================================================
// Account Structs - Subscriptions
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct SubscriptionConfig {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub basic_price: u64,     // Lamports
    pub pro_price: u64,
    pub alpha_price: u64,
    pub subscription_duration: i64, // seconds
    pub total_subscribers: u64,
    pub total_revenue: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Subscription {
    pub user: Pubkey,
    pub tier: u8,             // 1=Basic, 2=Pro, 3=Alpha
    pub expires_at: i64,
    pub created_at: i64,
    pub total_paid: u64,
    pub bump: u8,
}

// ============================================================================
// Error Codes
// ============================================================================

#[error_code]
pub enum ErrorCode {
    #[msg("Risk score must be between 0 and 100")]
    InvalidRiskScore,
    #[msg("Risk level must be 0 (HIGH), 1 (MEDIUM), or 2 (LOW)")]
    InvalidRiskLevel,
    #[msg("Protocol name must be 32 characters or less")]
    ProtocolNameTooLong,
    #[msg("Invalid subscription tier (must be 1-3)")]
    InvalidTier,
    #[msg("Invalid treasury account")]
    InvalidTreasury,
    #[msg("Subscription expired or insufficient tier")]
    InsufficientSubscription,
    #[msg("Unauthorized")]
    Unauthorized,
}
