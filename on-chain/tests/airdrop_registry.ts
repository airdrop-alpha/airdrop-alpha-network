import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AirdropRegistry } from "../target/types/airdrop_registry";
import { expect } from "chai";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

describe("airdrop_registry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AirdropRegistry as Program<AirdropRegistry>;
  const authority = provider.wallet;

  // Generate a fake token mint for testing
  const tokenMint = Keypair.generate();

  let registryPda: PublicKey;
  let registryBump: number;
  let reportPda: PublicKey;
  let reportBump: number;

  before(async () => {
    // Derive PDAs
    [registryPda, registryBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry"), authority.publicKey.toBuffer()],
      program.programId
    );

    [reportPda, reportBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("safety_report"),
        tokenMint.publicKey.toBuffer(),
        authority.publicKey.toBuffer(),
      ],
      program.programId
    );
  });

  it("Initializes the registry", async () => {
    const tx = await program.methods
      .initializeRegistry()
      .accounts({
        registry: registryPda,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("  Initialize registry tx:", tx);

    const registry = await program.account.registry.fetch(registryPda);
    expect(registry.authority.toBase58()).to.equal(
      authority.publicKey.toBase58()
    );
    expect(registry.totalReports.toNumber()).to.equal(0);
  });

  it("Submits a safety report", async () => {
    const tx = await program.methods
      .submitReport("TestProtocol", 85, 2, 3)
      .accounts({
        safetyReport: reportPda,
        registry: registryPda,
        tokenMint: tokenMint.publicKey,
        authority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("  Submit report tx:", tx);

    const report = await program.account.safetyReport.fetch(reportPda);
    expect(report.authority.toBase58()).to.equal(
      authority.publicKey.toBase58()
    );
    expect(report.tokenMint.toBase58()).to.equal(
      tokenMint.publicKey.toBase58()
    );
    expect(report.riskScore).to.equal(85);
    expect(report.riskLevel).to.equal(2);
    expect(report.flagsCount).to.equal(3);
    expect(report.protocolName).to.equal("TestProtocol");

    // Check registry was updated
    const registry = await program.account.registry.fetch(registryPda);
    expect(registry.totalReports.toNumber()).to.equal(1);
  });

  it("Updates a safety report", async () => {
    const tx = await program.methods
      .updateReport("TestProtocol v2", 92, 2, 1)
      .accounts({
        safetyReport: reportPda,
        authority: authority.publicKey,
      })
      .rpc();

    console.log("  Update report tx:", tx);

    const report = await program.account.safetyReport.fetch(reportPda);
    expect(report.riskScore).to.equal(92);
    expect(report.riskLevel).to.equal(2);
    expect(report.flagsCount).to.equal(1);
    expect(report.protocolName).to.equal("TestProtocol v2");
  });

  it("Rejects invalid risk score (> 100)", async () => {
    const anotherMint = Keypair.generate();
    const [anotherReportPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("safety_report"),
        anotherMint.publicKey.toBuffer(),
        authority.publicKey.toBuffer(),
      ],
      program.programId
    );

    try {
      await program.methods
        .submitReport("BadScore", 101, 0, 5)
        .accounts({
          safetyReport: anotherReportPda,
          registry: registryPda,
          tokenMint: anotherMint.publicKey,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have thrown an error");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("InvalidRiskScore");
    }
  });

  it("Rejects invalid risk level (> 2)", async () => {
    const anotherMint = Keypair.generate();
    const [anotherReportPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("safety_report"),
        anotherMint.publicKey.toBuffer(),
        authority.publicKey.toBuffer(),
      ],
      program.programId
    );

    try {
      await program.methods
        .submitReport("BadLevel", 50, 3, 5)
        .accounts({
          safetyReport: anotherReportPda,
          registry: registryPda,
          tokenMint: anotherMint.publicKey,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have thrown an error");
    } catch (err: any) {
      expect(err.error.errorCode.code).to.equal("InvalidRiskLevel");
    }
  });
});
