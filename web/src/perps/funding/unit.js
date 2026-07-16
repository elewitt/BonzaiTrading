/**
 * Unit Protocol provider — testnet stub.
 * Replace UnitDemoIo with a real UnitIo for mainnet.
 */
import { PROTOCOL } from "../config.js";

export class UnitProvider {
  constructor(io) {
    this.rail = "unit";
    this.io = io;
  }

  async quote(inputSol, _user) {
    if (inputSol < PROTOCOL.MIN_UNIT_SOL_DEPOSIT) {
      throw new Error(`Unit minimum is ${PROTOCOL.MIN_UNIT_SOL_DEPOSIT} SOL`);
    }
    const px = await this.io.solUsdPrice();
    const gross = inputSol * px;
    const feeUsd = 1 + gross * 0.0007;
    return {
      rail: this.rail,
      estimatedUsdcOut: gross - feeUsd,
      estimatedSeconds: 600,
      feeUsd,
    };
  }

  async advance(state) {
    const { evm, solana } = state.user;
    switch (state.step) {
      case "QUOTING":
        return { ...state, step: "BRIDGING", updatedAt: Date.now() };

      case "BRIDGING": {
        if (!state.legs.bridgeTxId) {
          const addr = await this.io.depositAddress(evm);
          const { txSig } = await this.io.sendSol(solana, addr, state.inputSol);
          return {
            ...state,
            legs: { ...state.legs, bridgeTxId: txSig },
            step: "AWAITING_HL_CREDIT",
            updatedAt: Date.now(),
          };
        }
        return { ...state, step: "AWAITING_HL_CREDIT", updatedAt: Date.now() };
      }

      case "AWAITING_HL_CREDIT": {
        const bal = await this.io.hlSpotSolBalance(evm);
        if (bal <= 0) return state;
        return { ...state, step: "SELLING_SPOT_SOL", updatedAt: Date.now() };
      }

      case "SELLING_SPOT_SOL": {
        if (state.legs.spotSellOid == null) {
          const bal = await this.io.hlSpotSolBalance(evm);
          const { oid } = await this.io.sellSpotSolForUsdc(evm, bal);
          return {
            ...state,
            legs: { ...state.legs, spotSellOid: oid },
            step: "TRANSFERRING_TO_PERPS",
            updatedAt: Date.now(),
          };
        }
        return { ...state, step: "TRANSFERRING_TO_PERPS", updatedAt: Date.now() };
      }

      case "TRANSFERRING_TO_PERPS": {
        if (state.legs.perpsTransferNonce == null) {
          const { nonce } = await this.io.transferSpotToPerps(evm, Number.MAX_SAFE_INTEGER);
          return {
            ...state,
            legs: { ...state.legs, perpsTransferNonce: nonce, hlCreditObserved: true },
            step: "DONE",
            updatedAt: Date.now(),
          };
        }
        return { ...state, step: "DONE", updatedAt: Date.now() };
      }

      default:
        return state;
    }
  }
}

export class UnitDemoIo {
  constructor(solPrice = 150) {
    this._solPrice = solPrice;
    this._credited = new Map();
    this._creditDelay = 20000;
  }

  async solUsdPrice() { return this._solPrice; }

  async depositAddress(_evm) {
    return "UnitDemoDepositAddress1111111111111111111";
  }

  async sendSol(_from, _to, _amount) {
    const txSig = `unitDemoTx_${Date.now()}`;
    this._credited.set(_to, Date.now() + this._creditDelay);
    return { txSig };
  }

  async hlSpotSolBalance(evm) {
    const creditedAt = this._credited.get("UnitDemoDepositAddress1111111111111111111");
    return creditedAt && Date.now() >= creditedAt ? 0.5 : 0;
  }

  async sellSpotSolForUsdc(_evm, amountSol) {
    return { oid: Math.floor(Math.random() * 1e9), usdcOut: amountSol * this._solPrice * 0.999 };
  }

  async transferSpotToPerps(_evm, _usdc) {
    return { nonce: Math.floor(Math.random() * 1e9) };
  }
}
