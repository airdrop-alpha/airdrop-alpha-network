use anchor_lang::prelude::*;

declare_id!("38CFzCb11EneZMQujTVZqJmXU7mXLxMg9fsS9hSZgnsC"); // Will be replaced after first build

/// AirdropAlpha Registry Program
/// Stores airdrop safety analysis results on-chain for transparency and verifiability.
#[program]
pub mod airdrop_registry {
    use super::*;

    /// Initialize a new registry for an authority.
    /// Each authority (analyst) gets their own registry to track their reports.
    pub fn initialize_registry(ctx: Context<InitializeRegistry>) -> Result<()> {
        let registry = &mut ctx.accounts.registry;
        registry.authority = ctx.accounts.authority.key();
        registry.total_reports = 0;
        registry.bump = ctx.bumps.registry;

        msg!(
            "Registry initialized for authority: {}",
            ctx.accounts.authority.key()
        );
        Ok(())
    }

    /// Submit a new safety analysis report for a token.
    /// Creates a PDA derived from the token mint and authority.
    pub fn submit_report(
        ctx: Context<SubmitReport>,
        protocol_name: String,
        risk_score: u8,
        risk_level: u8,
        flags_count: u8,
    ) -> Result<()> {
        // Validate inputs
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

        // Increment total reports in registry
        let registry = &mut ctx.accounts.registry;
        registry.total_reports = registry.total_reports.checked_add(1).unwrap();

        msg!(
            "Safety report submitted: {} | score: {} | level: {} | flags: {}",
            protocol_name,
            risk_score,
            risk_level,
            flags_count
        );
        Ok(())
    }

    /// Update an existing safety report with new analysis data.
    /// Only the original authority can update their reports.
    pub fn update_report(
        ctx: Context<UpdateReport>,
        protocol_name: String,
        risk_score: u8,
        risk_level: u8,
        flags_count: u8,
    ) -> Result<()> {
        // Validate inputs
        require!(risk_score <= 100, ErrorCode::InvalidRiskScore);
        require!(risk_level <= 2, ErrorCode::InvalidRiskLevel);
        require!(protocol_name.len() <= 32, ErrorCode::ProtocolNameTooLong);

        let report = &mut ctx.accounts.safety_report;
        report.risk_score = risk_score;
        report.risk_level = risk_level;
        report.flags_count = flags_count;
        report.protocol_name = protocol_name.clone();
        report.timestamp = Clock::get()?.unix_timestamp;

        msg!(
            "Safety report updated: {} | new score: {} | level: {} | flags: {}",
            protocol_name,
            risk_score,
            risk_level,
            flags_count
        );
        Ok(())
    }
}

// ============================================================================
// Account Contexts
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
        seeds = [
            b"safety_report",
            token_mint.key().as_ref(),
            authority.key().as_ref()
        ],
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

    /// CHECK: This is the token mint address used as a seed. We don't need to deserialize it.
    pub token_mint: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateReport<'info> {
    #[account(
        mut,
        seeds = [
            b"safety_report",
            safety_report.token_mint.as_ref(),
            authority.key().as_ref()
        ],
        bump = safety_report.bump,
        has_one = authority
    )]
    pub safety_report: Account<'info, SafetyReport>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

// ============================================================================
// Account Structs
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct SafetyReport {
    /// The authority (analyst) who submitted this report
    pub authority: Pubkey,
    /// The token mint being analyzed
    pub token_mint: Pubkey,
    /// Safety score 0-100 (higher = safer)
    pub risk_score: u8,
    /// Risk level: 0=HIGH, 1=MEDIUM, 2=LOW
    pub risk_level: u8,
    /// Number of risk flags identified
    pub flags_count: u8,
    /// Protocol/project name (max 32 chars)
    #[max_len(32)]
    pub protocol_name: String,
    /// Unix timestamp of the report
    pub timestamp: i64,
    /// PDA bump seed
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Registry {
    /// The authority who owns this registry
    pub authority: Pubkey,
    /// Total number of reports submitted
    pub total_reports: u64,
    /// PDA bump seed
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
}
