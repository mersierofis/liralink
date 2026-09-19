import { Module } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';
import { AppConfig } from '../config/app-config';
import { ListenerModule } from '../listener/listener.module';
import { INVOICE_CHAIN, SorobanInvoiceChain } from './invoice-chain';
import { InvoiceContractService } from './invoice-contract.service';
import { InvoiceWatcher } from './invoice-watcher.service';

/** The Soroban contract rail. With INVOICE_CONTRACT_ID empty the chain is null and the rail is off. */
@Module({
  imports: [ListenerModule],
  providers: [
    {
      provide: INVOICE_CHAIN,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => {
        const { INVOICE_CONTRACT_ID, SOROBAN_RPC_URL, NETWORK_PASSPHRASE, PLATFORM_ACCOUNT_SECRET } = config.env;
        // env.ts guarantees the RPC URL and passphrase whenever a contract id is set.
        if (!INVOICE_CONTRACT_ID || !SOROBAN_RPC_URL || !NETWORK_PASSPHRASE) return null;
        return new SorobanInvoiceChain(INVOICE_CONTRACT_ID, SOROBAN_RPC_URL, Keypair.fromSecret(PLATFORM_ACCOUNT_SECRET), NETWORK_PASSPHRASE);
      },
    },
    InvoiceContractService,
    InvoiceWatcher,
  ],
  exports: [InvoiceContractService, InvoiceWatcher],
})
export class InvoiceModule {}
