# Lemon (`com.applemoncash`) API — reverse-engineering notes

Endpoints used by the **Lemon** app ("Lemon - Billetera virtual", package `com.applemoncash`,
Google Play: <https://play.google.com/store/apps/details?id=com.applemoncash>). Collected to build the
[`lemon` LaWallet plugin](./README.md).

> **Risk / legal.** This is Lemon's **private, unofficial** API. Lemon does not publish it. Everything here was
> read out of the shipped Android app; Lemon can change or break any of it without notice, the server enforces
> device signatures and OTP that a non-app client can't fully reproduce, and using it this way may conflict with
> Lemon's terms of service. Treat it as research. Ask Lemon for official API access before shipping anything that
> depends on it outside debug builds.

## How this was obtained

1. The APK was pulled from an installed device, not a mirror (the app is geo-restricted and not on the usual
   APK mirrors):
   ```bash
   adb shell pm path com.applemoncash
   adb pull /data/app/.../com.applemoncash-.../base.apk base.apk
   ```
   Version at time of capture: **`versionName=3.0.21`, `versionCode=1614368038`**, `targetSdk=36`.
2. The app is **React Native** with a **Hermes** bytecode bundle at `assets/index.android.bundle`
   (Hermes bytecode **version 96**). It is not plain JS, so `strings` alone glues the literals together.
3. The Hermes string table and bytecode were parsed with [`hermes-dec`](https://github.com/P1sec/hermes-dec):
   - string table → clean endpoint paths, header names, GraphQL documents;
   - disassembly → the request/response object shapes for the wallet endpoints below.

Everything marked **UNVERIFIED** was read from the bundle but **not** exercised against a live account.

## Transports

Lemon uses three transports off a single host, **`api.lemoncash.io`**:

| Transport | Base | Notes |
|---|---|---|
| REST | `https://api.lemoncash.io/api` | Routes are the `/v1/...` paths below (e.g. `GET https://api.lemoncash.io/api/v1/ip-location`). The RN HTTP helper wraps every call as `{ route, body }` and returns `{ data, error, status }`, with `data` keys camelCased client-side (`keysToCamel`). A `body` present ⇒ `POST`. |
| GraphQL (Apollo) | `https://api.lemoncash.io/api/graphql` | 275 queries, 152 mutations, 1 subscription embedded in the bundle (full list below). |
| WebSocket | `wss://api.lemoncash.io/ws/v3/` | Carries the `subscription ResourceUpdates` live feed (balances / activity). Not reachable from the plugin sandbox. |

Staging/CDN host seen: `static.api-staging.lemoncash.com.ar`. Static assets: `static.lemon.me`.
Analytics/telemetry (not part of the wallet API): RudderStack (`api.rudderlabs.com`), Sentry, Datadog (`LogDatadog`).

## Auth model

- **Scheme:** `Authorization: Bearer <accessToken>` on every authenticated call.
- **Native login flow (what the app does):** phone/email → `POST /v1/auth/v2/first-step` → OTP → `POST /v1/auth/v2/second-step`
  (SMS/authenticator via `/v1/mfa/*`), issuing a session (`accessToken`, `sessionToken`, `deviceId`, `expiresAt`).
  `GET /v1/auth/v2/current-session` validates it; `/v1/auth/v2/sessions` lists devices; `/v1/auth/v2/sign-out[-all]` revokes.
  Biometric re-login: `/v1/biometrics/{first-step,second-step,login}`.
- **Device binding:** requests carry a device fingerprint/signature (headers below). The server rejects calls whose
  device signature it doesn't recognise, which is why a headless client generally can't complete the native login —
  it has to reuse a session created by the real app or the web app.
- **Step-up OTP on money-out:** sensitive operations check `query OtpRequirement` / `query MinOtpAmount`
  (`REST /v1/direct-transfers/otp-requirement`) and, when required, attach an OTP header to the request
  (see `otpHeader` on the transfer body) plus an `Idempotency-Key`.

### Request headers (seen in the bundle)

| Header | Purpose |
|---|---|
| `Authorization` | `Bearer <accessToken>` |
| `X-Lemon-App-Version` | App version string |
| `X-Header-DeviceId` | Per-install device id |
| `X-Device-Model` / `-Brand` / `-Type` / `-OS` / `-OS-Version` / `-Carrier` / `-AdvertisingId` | Device fingerprint |
| `X-Device-Fingerprint` / `X-Device-Signature` | Device attestation / integrity signature |
| `Idempotency-Key` | De-dupes money-moving POSTs (`IDEMPOTENCY_KEY_HEADER`) |
| `X-Canary`, `X-Client-Info`, `X-Request-Id`, `User-Agent` | Routing / telemetry |

## Wallet-relevant endpoints (decoded shapes)

These are the endpoints the plugin builds on. Fields are from the Hermes disassembly; response shapes are
**UNVERIFIED** unless noted.

### Balance — `query Wallets` (or `GET /v1/wallets/`)
```graphql
query Wallets($currency: String) {
  wallets(currency: $currency) {
    accountId
    balance
    displayedBalance
    currency          # "BTC", "USDT", "ARS", "BRL", ...
    frozenBalance
    frozenAmounts { id amount cause description createdAt }
    isFavorite
    createdAt
    updatedAt
  }
}
```
`balance` is a decimal crypto/fiat amount in `currency` units (BTC with 8 decimals for the BTC wallet —
**unit UNVERIFIED**, could be a string). REST `GET /v1/wallets/` returns the same records under `data`.

### Receive — `POST /v1/lightning-invoice`
Request body (from disassembly):
```json
{ "amount": <number>, "description": "<memo>", "ttl": <seconds> }
```
Response `data` (fields present in the bundle, exact mapping **UNVERIFIED**):
`paymentRequest` (the BOLT11 `lnbc...`), `invoice`, `expiresAt` / `expirationDate`, `qr` / `qrCode`, `amountLightning`.

### Send / pay a Lightning invoice — `POST /v1/wallet-to-external-crypto-wallet-transfers-v2`
Request body (from disassembly — note snake_case):
```json
{
  "amount": <number>,
  "external_crypto_wallet_address": "<bolt11 | on-chain address>",
  "external_crypto_wallet_address_tag": "<memo tag, optional>",
  "network": "LIGHTNING",            // also BITCOIN | POLYGON | SOLANA | ...
  "currency": "BTC"
}
```
Headers: `Idempotency-Key`, and an OTP header (`otpHeader`) when `OtpRequirement` says so.
Supporting: `GET /v1/wallet-to-external-crypto-wallet-transfers/networks/`,
`.../minimums`, `query Web3WithdrawCurrenciesAndNetworks`, `query Web3NetworksFees`.
Lightning validation strings in the app: "Lightning Payment Request must be string",
"Not a proper lightning payment request".

### History — `query OwnActivities` (or `GET /v1/activities-v2/`)
```graphql
query OwnActivities($limit: Int!, $offset: Int!) {
  ownActivities(limit: $limit, offset: $offset) {
    content { activityType createdAt details id referenceId availableTopics { ... } }
    hasNext limit offset
  }
}
```
`details` is an opaque per-activity JSON blob (shape varies by `activityType`) — **UNVERIFIED**.
Single lookup: `query OwnActivityByReferenceId`.

### Rates — `query ExchangeRates`
```graphql
query ExchangeRates {
  exchangeRates {
    instrument                       # e.g. "BTC_ARS"
    purchasePrice { amount currency }
    salePrice { amount currency }
    versionMap isVisible
  }
}
```

### Account — `query User` (or `GET /v1/user`)
Returns `email`, `alias`, `referenceCurrency`, `operationCountry`, `accountId`, `mfaMethod`, KYC/account state, etc.
Used for the plugin's `account` label.

### OTP gate — `query OtpRequirement`
```graphql
query OtpRequirement($cashOut: OtpRequirementCashOutInput!) { otpRequirement(cashOut: $cashOut) { otpRequired } }
```

---

## Full endpoint inventory

### REST paths (168) — relative to `https://api.lemoncash.io/api`
- `/v1/accounts/address`
- `/v1/accounts/blockage/resend-notification`
- `/v1/accounts/blockage/resend-notification-for-email`
- `/v1/accounts/closure`
- `/v1/accounts/closure-requirements`
- `/v1/activities-v2/`
- `/v1/address-details`
- `/v1/address-predictions`
- `/v1/agora/post-transaction-update`
- `/v1/alias`
- `/v1/app-accesses`
- `/v1/arg/automatic-transfer-request-subscriptions`
- `/v1/arg/automatic-transfer-request-subscriptions/`
- `/v1/arg/cash-out`
- `/v1/arg/cash-out/contact`
- `/v1/arg/qr-payments`
- `/v1/arg/qr-payments/`
- `/v1/auth/v2/current-session`
- `/v1/auth/v2/first-step`
- `/v1/auth/v2/resend-otp`
- `/v1/auth/v2/second-step`
- `/v1/auth/v2/sessions`
- `/v1/auth/v2/sign-out`
- `/v1/auth/v2/sign-out-all`
- `/v1/auth/v2/sign-out/`
- `/v1/bank-accounts`
- `/v1/bank-accounts/`
- `/v1/bank-accounts/details`
- `/v1/bank-accounts/grouped-by-tax-id`
- `/v1/biometrics/first-step`
- `/v1/biometrics/last`
- `/v1/biometrics/login`
- `/v1/biometrics/second-step`
- `/v1/blacklist/crypto-addresses`
- `/v1/blacklist/fiat-addresses`
- `/v1/blacklist/tax-ids`
- `/v1/bra/cash-ins/`
- `/v1/bra/cash-outs`
- `/v1/bra/contacts`
- `/v1/bra/contacts/`
- `/v1/bra/limits`
- `/v1/bra/limits/pix-config`
- `/v1/bra/limits/pix-night-time-start-hour`
- `/v1/bra/limits/trusted-contacts/`
- `/v1/bra/pix-claims/`
- `/v1/bra/pix-keys/`
- `/v1/bra/pix-keys/qr-decode`
- `/v1/bra/scheduled-cash-outs`
- `/v1/bra/scheduled-cash-outs/`
- `/v1/bra/virtual-accounts`
- `/v1/cards`
- `/v1/cards/`
- `/v1/cards/activation`
- `/v1/cards/blockage`
- `/v1/cards/card-account`
- `/v1/cards/card-account/status`
- `/v1/cards/denouncement`
- `/v1/cards/enablement`
- `/v1/cards/estimated-shipping-time`
- `/v1/cards/last`
- `/v1/cards/last-shipping-address`
- `/v1/cards/last/tracking`
- `/v1/cards/limits-config`
- `/v1/cards/sensitive-data/token`
- `/v1/cards/spending-limits`
- `/v1/cards/spending-priority-order`
- `/v1/cards/token-provisioning`
- `/v1/cashback`
- `/v1/cashback/history`
- `/v1/charts/historic/`
- `/v1/compliance-asset-uri`
- `/v1/compliance-requests`
- `/v1/configs`
- `/v1/credit-cards/payments/`
- `/v1/crypto-addresses`
- `/v1/crypto-purchases`
- `/v1/crypto-sales`
- `/v1/crypto-swaps`
- `/v1/crypto-wallet-to-bank-account`
- `/v1/customer-identity`
- `/v1/digital-identity`
- `/v1/digital-identity/`
- `/v1/digital-identity/nft`
- `/v1/digital-identity/nft/`
- `/v1/direct-transfers`
- `/v1/direct-transfers/`
- `/v1/direct-transfers/contact`
- `/v1/direct-transfers/otp-requirement`
- `/v1/email-accesses`
- `/v1/email-accesses/`
- `/v1/email-verifications`
- `/v1/exchange-rates-quotations/`
- `/v1/external-crypto-wallets`
- `/v1/external-crypto-wallets/`
- `/v1/external-crypto-wallets/contact`
- `/v1/feature-toggles/`
- `/v1/fees`
- `/v1/fiat-stable-purchases`
- `/v1/fiat-stable-sales`
- `/v1/goerli/jsonrpc`
- `/v1/ip-location`
- `/v1/kovan/jsonrpc`
- `/v1/kycs/final-step`
- `/v1/kycs/status`
- `/v1/lb/`
- `/v1/lemon-achievements/achievements`
- `/v1/lemon-achievements/chests/`
- `/v1/lemon-card-rewards/config`
- `/v1/lemon-card-rewards/points`
- `/v1/lemon-hub/search-metrics`
- `/v1/lightning-invoice`
- `/v1/mainnet/jsonrpc`
- `/v1/mfa/authenticator`
- `/v1/mfa/generate-otp`
- `/v1/mfa/validate-sms-otp`
- `/v1/moneymarket/account/disable`
- `/v1/onboarding-access/code/`
- `/v1/passcode`
- `/v1/passcode-reset/`
- `/v1/passcode-reset/last`
- `/v1/passcode-reset/login`
- `/v1/passcode-reset/passwordless-login/`
- `/v1/passcode-reset/request/`
- `/v1/passcode-reset/request/asset-uri`
- `/v1/passcode-reset/reset-no-kyc`
- `/v1/passcode-reset/validate`
- `/v1/passcode-reset/validate/kyc`
- `/v1/phone-verification`
- `/v1/phone-verification-code`
- `/v1/pix-payments/`
- `/v1/popular-currencies`
- `/v1/proof-of-liabilities`
- `/v1/proof-of-liabilities/`
- `/v1/proof-of-liabilities/proof/`
- `/v1/refunds/`
- `/v1/report-requests`
- `/v1/rinkeby/jsonrpc`
- `/v1/ropsten/jsonrpc`
- `/v1/secure-passcode-verification/`
- `/v1/send-phone-verification-code`
- `/v1/services-payments/companies/subscriptions/`
- `/v1/signup`
- `/v1/terms`
- `/v1/terms/`
- `/v1/trade-orders`
- `/v1/trade-orders/`
- `/v1/transfer-requests`
- `/v1/transfer-requests/`
- `/v1/user`
- `/v1/user-public-key/`
- `/v1/users`
- `/v1/users-cash/email-reminder`
- `/v1/users/email/first-step`
- `/v1/users/email/second-step`
- `/v1/users/mfa/change`
- `/v1/users/mfa/disable`
- `/v1/users/mfa/enable`
- `/v1/users/passcode`
- `/v1/users/phone-number`
- `/v1/v2/compliance-requests`
- `/v1/virtual-accounts`
- `/v1/wallet-to-bank-transfers`
- `/v1/wallet-to-external-crypto-wallet-transfers-v2`
- `/v1/wallet-to-external-crypto-wallet-transfers/minimums`
- `/v1/wallet-to-external-crypto-wallet-transfers/networks/`
- `/v1/wallet-to-wallet-user-contacts`
- `/v1/wallets/`
- `/v1/whales`

### GraphQL queries (275) — `POST /api/graphql`
- `AccountStatementTypes`
- `AchCashOutCost`
- `Achievements`
- `Activities`
- `AdditionalDataConfigByCountry`
- `AddressTag`
- `AllowedForeignEntryAccounts`
- `ArgCashOutReceipt`
- `AutoSwapAllowedCurrencies`
- `BTCHalvingDate`
- `BankAccountDetails`
- `BanksByCountry`
- `BlockageWording`
- `BrebCashOutProviders`
- `BrebKeys`
- `BrebKeysFeatures`
- `CardAccountInfo`
- `CardLimitsConfig`
- `CardOrders`
- `CardRequirements`
- `CardSaleCommission`
- `CardSensitiveData`
- `CardUserLimit`
- `CardWaitingListDeeplink`
- `CardsInfo`
- `CardsInfoForWalletExtension`
- `CashInAllowedPairs`
- `CashInNetworks`
- `CashOutAllowedPairs`
- `CashOutFormFieldConfigByCountry`
- `CashbackSummary`
- `CashbackTransactions`
- `Catalogs`
- `CheckPixExistence`
- `CircuitBreakerStatus`
- `ColBreBCashOutKeyScan`
- `CollateralizedCreditLines`
- `CreditCardCollateralRequirements`
- `CreditCardConditions`
- `CreditCardLastDebt`
- `CreditCardLastMovements`
- `CreditCardLastStatementOverview`
- `CreditCardMovements`
- `CreditCardMovementsSummary`
- `CreditCardPaymentExchangeRate`
- `CreditCardStatementDownload`
- `CreditCardStatementsOverview`
- `CreditDebtFreeCertificate`
- `CreditDebtFreeCertificateAvailable`
- `CreditHome`
- `CreditNextPayment`
- `CreditOfferPreview`
- `CreditOfferTermPreviews`
- `CreditOverduePaymentQuote`
- `CreditOverdueQuote`
- `CreditPaidInstallments`
- `CreditPaymentHistory`
- `CreditPrepaymentQuote`
- `CreditRevocationQuote`
- `CrossSellingBanner`
- `CryptoOperationMinimums`
- `CryptoWalletToBankAccountReceipt`
- `Currencies`
- `CurrenciesCashInMinimum`
- `CurrencyNetworks`
- `CurrencySummaries`
- `CurrentSubscription`
- `DcaPlan`
- `DcaPlanExecutions`
- `DcaPlans`
- `DeferredPaymentsBalance`
- `DrawDates`
- `DynamicAddressConfigDataByCountry`
- `DynamicUserDataConfigByCountry`
- `EarningsSummary`
- `ExchangeRatePairInfo`
- `ExchangeRates`
- `ExternalUserInfo`
- `FeaturedLemonMiniApps`
- `FeaturedMiniApps`
- `FeedsByUser`
- `ForbiddenWords`
- `ForeignAccountDetails`
- `ForeignCurrencyConversion`
- `ForeignCurrencyExchangeRate`
- `ForeignExchangeRates`
- `FriendRequests`
- `FriendsCountQuery`
- `GetActiveCampaignByCode`
- `GetActiveCampaigns`
- `GetAddressConfigByCountry`
- `GetAllowedCountryList`
- `GetAllowedEvents`
- `GetAppFeatureToggles`
- `GetAppSettings`
- `GetAppSettings2`
- `GetAvailableRedemptionsCap`
- `GetCampaignTerms`
- `GetCardLimits`
- `GetCardMonthlyLimits`
- `GetCardPaymentStatisticsMonthlyAccumulated`
- `GetCardPaymentStatisticsMonthlyAccumulatedGroupedByCategory`
- `GetCatalogById`
- `GetCatalogContests`
- `GetContestResultById`
- `GetExternalDeviceRegistration`
- `GetFeatureToggles`
- `GetFiatCashInCashOutStatus`
- `GetLimits`
- `GetLimitsV2`
- `GetLinks`
- `GetOnboardingFlowProvider`
- `GetOnboardingModule`
- `GetOwnedPix`
- `GetPaymentActivitiesGroupedByCategory`
- `GetPhoneConfigByCountry`
- `GetPopularCurrencies`
- `GetReserves`
- `GetTransactionCosts`
- `HoldingSuggestion`
- `HomeLemonCardSection`
- `HowToEarnTicketsSteps`
- `Interactors`
- `InterestFundSubscriptions`
- `InterestFunds`
- `IntrospectionQuery`
- `InvestmentAccount`
- `InvestmentAccountTyc`
- `InvestmentActivities`
- `InvestmentAssetChart`
- `InvestmentAssetNews`
- `InvestmentAssetPack`
- `InvestmentAssetPacks`
- `InvestmentAssetSummary`
- `InvestmentAssetTags`
- `InvestmentAssets`
- `InvestmentDocuments`
- `InvestmentFavoriteAssets`
- `InvestmentFirstTimeSuggestions`
- `InvestmentIdeas`
- `InvestmentMarketCalendar`
- `InvestmentMarketClock`
- `InvestmentOnboardingBrackets`
- `InvestmentOnboardingQuestions`
- `InvestmentOrderQuote`
- `InvestmentOrders`
- `InvestmentPortfolioBalance`
- `InvestmentPortfolioHighlights`
- `InvestmentPosition`
- `InvestmentPositions`
- `InvestmentResults`
- `InvestmentResultsSummary`
- `InvestmentSuggestedEtfs`
- `InvestmentSuggestedPacks`
- `InvestmentSuggestedStocks`
- `InvestmentsPromo`
- `KycConfigByCountry`
- `LastShipmentOrder`
- `LemonCardAvailableCurrencies`
- `LemonCardCounters`
- `LemonHubAppById`
- `LemonHubApps`
- `ListOrders`
- `ListUserOrders`
- `LocalityListByCountry`
- `MarketSearch`
- `MarketSentiment`
- `MarketTrends`
- `MigrationStatus`
- `MinOtpAmount`
- `MiniApp`
- `MiniAppBalances`
- `MiniAppDepositFee`
- `MiniAppFiatTransferFees`
- `MiniAppFiatUserOperation`
- `MiniAppTokens`
- `MiniAppsByCategory`
- `MiniAppsV2`
- `MoneyMarketBalance`
- `MoneyMarketInfo`
- `MoneyMarketTotalEarnings`
- `Notifications`
- `OnrampTerms`
- `OnramperConfig`
- `OpenfinanceConsent`
- `OperationStatus`
- `OrderDetails`
- `OrderFees`
- `OrderMinimums`
- `OrderPairs`
- `OtpRequirement`
- `OwnActivities`
- `OwnActivityByReferenceId`
- `PaginatedFriendsQuery`
- `PeggedSettingStatus`
- `PeggedSettings`
- `PeruvianBankByParticipantCode`
- `PeruvianBankContacts`
- `PeruvianCashOutReceipt`
- `PeruvianContactSearch`
- `PeruvianDepartments`
- `PeruvianDistricts`
- `PeruvianEedeMigrationStatus`
- `PeruvianInternalTransfer`
- `PeruvianProvidersStatus`
- `PeruvianProvinces`
- `PeruvianUpdatePhoneStatus`
- `PeruvianVirtualAccount`
- `PeruvianVirtualAccountWithMigrationStatus`
- `PickUpPoints`
- `PixCircuitBreaker`
- `PixCurrencies`
- `PixPaymentInfo`
- `PixPaymentState`
- `PixTransactionStatus`
- `ProvinceListByCountry`
- `QRArgAllowedCurrencies`
- `QRArgConfig`
- `QRArgDecode`
- `Query`
- `ReadPeruvianQRCode`
- `RecommendedFriends`
- `Redemptions`
- `RewardsAccount`
- `RewardsActivities`
- `SearchFriendsQuery`
- `SearchLemonHubInvestments`
- `SecureDataToken`
- `SelectedWidgets`
- `SentryConfig`
- `ServiceDebtByNotification`
- `ServiceDebts`
- `ServiceStatus`
- `Services`
- `ServicesHighlighted`
- `ServicesSubscriptions`
- `ServicesSubscriptionsWithDebts`
- `ShipmentMethodsUrls`
- `ShippingSteps`
- `SpendingPriorityOrder`
- `SubscriptionCancellationPreview`
- `SubscriptionPackOffer`
- `SubscriptionPackStatus`
- `SubscriptionPackSubscription`
- `SubscriptionPlan`
- `SubscriptionPlans`
- `TermsAndConditions`
- `TicketBalance`
- `Tokenization`
- `Topics`
- `TransactionLimits`
- `User`
- `UserSettingsQuery`
- `ValidatePixPayment`
- `VirtualCardCreationLimits`
- `VirtualCardDesigns`
- `Wallets`
- `WalletsFees`
- `Web3DepositAddress`
- `Web3DepositCurrenciesAndNetworks`
- `Web3NetworksFees`
- `Web3Wallet`
- `Web3WithdrawCurrenciesAndNetworks`
- `WhalesPerks`
- `Widgets`
- `YieldAccrualDetail`
- `YieldAccruals`
- `YieldDashboardSummary`
- `activitiesFeed`
- `activityComments`
- `activityLikes`
- `appUpdateModal`
- `friendsActivityById`
- `getSocieties`
- `neighborhoodListByCountry`

### GraphQL mutations (152)
- `AcceptCreditOffer`
- `AcceptFriendRequest`
- `AcceptInvestmentTerms`
- `AcceptTerms`
- `AchCashOut`
- `ActivateBrebKey`
- `ActivateClickToPay`
- `ActivatePeggedCurrency`
- `ActivateYield`
- `ApproveOpenFinanceFlow`
- `AuthenticateMiniAppV2`
- `BlockBrebKey`
- `BlockUser`
- `CancelCreditCardCollateralWithdrawal`
- `CancelDcaPlan`
- `CancelFriendRequest`
- `CancelInvestmentOrder`
- `CancelPackSubscription`
- `CancelSubscription`
- `ClaimAchievementReward`
- `ClaimPix`
- `ClaimTickets`
- `CloseInvestmentAccount`
- `CloseVirtualAccount`
- `ColBreBCashOut`
- `CompletePixClaim`
- `ConfirmLegitimatePurchase`
- `ConfirmMcpAuth`
- `ConfirmMiniAppRequirements`
- `ConfirmPixPayment`
- `ConsultPeruvianCashOut`
- `ContractCall`
- `CreateAccount`
- `CreateActivity`
- `CreateArgentinianFullCashOut`
- `CreateCardAccount`
- `CreateCardOrder`
- `CreateCardShipment`
- `CreateCollateralizedCreditLine`
- `CreateColombianCashIn`
- `CreateColombianCashOut`
- `CreateColombianPSECashIn`
- `CreateCreditCard`
- `CreateDcaPlan`
- `CreateForeignAccount`
- `CreateInterestFundSubscription`
- `CreateInvestmentAccount`
- `CreateInvestmentOrder`
- `CreateInvestmentPackOrder`
- `CreateMiniAppSession`
- `CreateOpenFinanceFlow`
- `CreatePeruvianCashOut`
- `CreatePeruvianFullCashOut`
- `CreatePeruvianVirtualAccount`
- `CreatePix`
- `CreatePixQR`
- `CreateTokenization`
- `CreateVirtualCard`
- `CustomizeVirtualCard`
- `DeactivateClickToPay`
- `DeactivatePeggedCurrency`
- `DeactivateYield`
- `DeleteActivity`
- `DeleteComment`
- `DeleteFriend`
- `DeletePeruvianVirtualAccount`
- `DeleteTrustedDevice`
- `DeleteVirtualCard`
- `DenounceCard`
- `DepositToMiniApp`
- `DisableBrebKey`
- `DisableMMAccount`
- `DislikeActivity`
- `DislikeActivityComment`
- `EnableMMAccount`
- `EstimateInvestmentOrder`
- `EstimateInvestmentPackOrder`
- `FavoriteInvestmentAsset`
- `FinishIncodeOnboarding`
- `FinishRevalidation`
- `GeneratePeruvianQRCode`
- `GetFriendsInContacts`
- `LikeActivity`
- `LikeActivityComment`
- `LogDatadog`
- `MakeP2POrder`
- `MarkBankContactAsFavorite`
- `MarkNotificationsAsViewed`
- `MigrateCardToPomelo`
- `MiniAppFiatTransfer`
- `ModifyBrebKey`
- `PauseCard`
- `PauseDcaPlan`
- `PayCreditCard`
- `PayCreditCardCollateral`
- `PayCreditInstallment`
- `PrepayCredit`
- `ProvisionCardToken`
- `ReactivateSubscription`
- `RedeemCatalog`
- `RefuseOpenFinanceFlow`
- `RegisterExternalDevice`
- `RegisterExternalDeviceMfaAttempt`
- `RejectFriendRequest`
- `RemoveAccountFromContact`
- `RemoveAccountFromTrusted`
- `RemoveContact`
- `RemoveP2POrder`
- `RemovePixKey`
- `ReportFraud`
- `RequestAccountStatement`
- `RequestCreditCardCollateralWithdrawal`
- `ResumeDcaPlan`
- `RevokeCredit`
- `SavePeruvianContact`
- `SendAllFriendsRequest`
- `SendFriendRequest`
- `SendPeruvianPhoneUpdateOtp`
- `ServicePayment`
- `SetCardPin`
- `SetDaleAccountAsDefault`
- `SetSpendingPriorityOrder`
- `SetUserSettings`
- `SmartContractFee`
- `StartIncodeOnboarding`
- `StartRevalidation`
- `StopInvestingEarn`
- `SubmitReferralCode`
- `SubscribeToPack`
- `SubscribeToPlan`
- `TakeOrder`
- `TrackAppUsed`
- `TransferTickets`
- `UnblockBrebKey`
- `UnblockUser`
- `UnfavoriteInvestmentAsset`
- `UnmarkBankContactAsFavorite`
- `UnpauseCard`
- `UpdateAdditionalDataFromDynamicUserData`
- `UpdateAlphanumericKey`
- `UpdateCardLimits`
- `UpdateDcaPlan`
- `UpdateInterestFundSubscription`
- `UpdateInvestorProfile`
- `UpdateMinOtpAmount`
- `UpdatePeruvianPhone`
- `UpdateProtocolSubscription`
- `UpdateUserFromDynamicUserData`
- `UpdateUserUbigeo`
- `UpdateWidgets`
- `WithdrawFromMiniApp`
- `createComment`

### GraphQL subscriptions (1) — `wss://api.lemoncash.io/ws/v3/`
- `ResourceUpdates`

---

*Generated from `com.applemoncash` v3.0.21 (Hermes bytecode v96) with `hermes-dec`. Names are the literals
embedded in the app; request/response shapes beyond the decoded ones above are not documented by Lemon and
were not tested against a live account.*
