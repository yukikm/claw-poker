use anchor_lang::prelude::*;

declare_id!("6fSvbYjLzzqF6vZmcZ3rcFqw1hqbHAkskCNsCp7QCCAo");

#[program]
pub mod claw_poker {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
