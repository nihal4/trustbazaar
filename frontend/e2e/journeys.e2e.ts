// The journeys of docs/design/08_frontend.pdf section 12 (U8-11), through the real screens against the backend with
// the mock providers: register, KYC with Chromium's fake camera, list, buy with the mock bKash, the handover code and
// confirming receipt; two browsers bidding live; the sealed game-account handover; a dispute decided in the console
// with four-eyes; and signing out on one tab ending the others.
import { join } from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { codeSentTo, fixtures, photo, signInMember, signInStaff, STATES } from './fixtures';

const f = fixtures();
const state = (role: 'buyer' | 'operator' | 'administrator') => join(STATES, `${role}.json`);
const unique = () => `${Date.now()}`.slice(-8);
const staff = (browser: Browser, role: 'operator' | 'administrator'): Promise<BrowserContext> => browser.newContext({ storageState: state(role) });

/** From an open listing page: checkout with self pickup, then pay on the mock bKash page; returns the order's path. */
async function buyWithMockBkash(page: Page, price: string): Promise<string> {
  await page.getByRole('link', { name: `Buy now for ${price}` }).click();
  await expect(page.getByText(`Total to pay: ${price}`)).toBeVisible();
  await page.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(page.getByText('Waiting for payment')).toBeVisible();
  const orderPath = new URL(page.url()).pathname;
  await payWithMockBkash(page, price);
  return orderPath;
}

/** On an order waiting for payment: bKash, the confirmation, then "Pay" on the mock provider's page, and back. */
async function payWithMockBkash(page: Page, price: string): Promise<void> {
  const orderPath = new URL(page.url()).pathname;
  await page.getByLabel('bKash').check();
  await page.getByRole('button', { name: `Pay ${price}` }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirm your payment' });
  await expect(confirm).toContainText(`You will pay ${price} in total`);
  await confirm.getByRole('button', { name: `Pay ${price}` }).click();
  await expect(page.getByRole('heading', { name: 'Simulated bkash payment' })).toBeVisible();
  await expect(page.getByText(`Amount: BDT ${price.slice(1)}.00`)).toBeVisible();
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await page.waitForURL((u) => u.pathname === orderPath);
}

test.describe.configure({ mode: 'serial' });

test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

test('IF-UI-01 IF-UI-02 IF-UI-03 IF-UI-04 IF-UI-05 a new member registers, passes KYC, lists an item; a buyer pays with the mock bKash, collects it with the handover code and confirms receipt', async ({ browser }) => {
  test.setTimeout(240_000);
  const n = unique();
  const phone = `017${n}`;
  const seller = await browser.newContext({ permissions: ['camera'] });
  const page = await seller.newPage();
  const operator = await staff(browser, 'operator');

  // register, one question at a time: the name, the e-mail address, the password twice, the code from the simulated e-mail, the number, the terms (U10-25)
  const email = `nasrin-${n}@tb.test`;
  const next = () => page.getByRole('button', { name: 'Continue' }).click();
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Nasrin Seller');
  await next();
  await page.getByLabel('E-mail address').fill(email);
  await next();
  await page.getByLabel('Password', { exact: true }).fill('copper lantern river breakfast');
  await page.getByLabel('Confirm password').fill('copper lantern river breakfast');
  await next();
  const code = await codeSentTo(operator.request, email);
  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await page.getByLabel('Mobile number').fill(phone);
  await next();
  await page.getByLabel('I am 18 years old or older.').check();
  await page.getByRole('checkbox', { name: /I accept the/ }).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  // the account exists but nobody is signed in: the sign-in page follows with the e-mail address filled in, and the e-mail address is already verified by the code
  await page.waitForURL((u) => u.pathname.startsWith('/signin'));
  await next();
  await page.getByLabel('Password', { exact: true }).fill('copper lantern river breakfast');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect.poll(() => codeSentTo(operator.request, email), { timeout: 15_000 }).not.toBe(code);        // the sign-in code is the newest message
  await page.getByLabel('Code').fill(await codeSentTo(operator.request, email));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'));

  // KYC with Chromium's fake camera (a moving test pattern): the details, both sides of the NID and the two selfies
  await page.goto('/account/kyc');
  await page.getByRole('button', { name: 'Start' }).click();
  await page.getByLabel('NID number').fill(`19950${n}`);
  await page.getByLabel('Full name').fill('NASRIN AKTER');
  await page.getByLabel('Date of birth').fill('1995-04-12');
  await page.getByRole('button', { name: 'Continue' }).click();
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Start the camera' }).click();
    await page.getByRole('button', { name: 'Take the photo' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  const sent = page.waitForResponse((r) => r.url().endsWith('/api/v1/kyc/submissions') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send for review' }).click();
  const { submissionId } = (await (await sent).json()) as { submissionId: string };
  const ref = submissionId.slice(0, 8);
  await expect(page.getByText('Waiting for review.')).toBeVisible();

  // an operator claims the submission in the console and approves it
  const console_ = await operator.newPage();
  await console_.goto('/staff/queues/kyc');
  await console_.getByRole('button', { name: `Claim ${ref}` }).click();
  await console_.getByRole('link', { name: `Open ${ref}` }).click();
  await expect(console_.getByRole('heading', { name: `KYC submission ${ref}` })).toBeVisible();
  await console_.getByRole('button', { name: 'Show' }).first().click();
  await console_.getByLabel('Why you need to see the Front of the document').fill('Checking the document against the details typed');
  await console_.getByRole('button', { name: 'Open with this reason' }).click();
  const link = console_.getByRole('link', { name: 'Open the file' });
  const file = await operator.request.get((await link.getAttribute('href'))!);
  expect(file.headers()['content-type']).toMatch(/^image\//); // the sealed image comes back whole, as an image
  expect((await file.body()).length).toBeGreaterThan(1000);
  await console_.getByLabel('Approve: the member is verified').check();
  await console_.getByLabel('Reason (recorded with the action)').fill('Document and selfies match the details');
  await console_.getByRole('button', { name: 'Decide' }).click();
  await console_.getByRole('dialog', { name: 'Decide the submission' }).getByRole('button', { name: 'Decide' }).click();
  await page.reload();
  await expect(page.getByText('Your identity is verified.')).toBeVisible();

  // the new seller lists a phone: the details, two photos, the price, then publishes
  await page.goto('/sell/new');
  const title = `Walton Primo phone ${n}`;
  await page.getByLabel('Category').selectOption({ label: 'Phones' });
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Description').fill('Two years old, works well, battery holds a day. Charger included.');
  await page.getByLabel('Condition').selectOption({ label: 'Used' });
  await page.getByLabel('The item has no visible defects').check();
  await page.getByLabel('How the buyer gets it').selectOption({ label: 'Pickup from you only' });
  await page.getByLabel('Price (taka)').fill('8500');
  await page.getByLabel('Area').selectOption({ label: 'Dhanmondi, Dhaka' });
  await page.getByRole('button', { name: 'Save as a draft' }).click();
  await expect(page.getByText('Draft, not visible to buyers')).toBeVisible();
  const listingId = new URL(page.url()).pathname.split('/').pop()!;
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Add photos/ }).click();
  await (await chooser).setFiles([photo(1), photo(2)]);
  await expect(page.getByRole('region', { name: 'Photos' }).getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();

  // a buyer finds it, pays with the mock bKash and is back on the order
  const buyer = await browser.newContext({ storageState: state('buyer') });
  const shopper = await buyer.newPage();
  await shopper.goto(`/listings/${listingId}`);
  await expect(shopper.getByRole('heading', { name: title })).toBeVisible();
  expect(await shopper.getByRole('img', { name: `${title}, photo 1 of 2` }).evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  const orderPath = await buyWithMockBkash(shopper, '৳8,500');
  await expect(shopper.getByText('Payment received. Your money is held by TrustBazaar until you have the item.')).toBeVisible();
  await expect(shopper.getByRole('region', { name: 'Meetup handover' })).toBeVisible({ timeout: 20_000 }); // created from the paid event
  await expect(shopper.getByText('This page or item no longer exists.')).toHaveCount(0);

  // they agree where to meet: the buyer proposes, the seller accepts
  const handover = shopper.getByRole('region', { name: 'Meetup handover' });
  await handover.getByRole('button', { name: 'Propose a place and time' }).click();
  const tomorrow = new Date(Date.now() + 6 * 3_600_000 + 24 * 3_600_000).toISOString().slice(0, 10); // Dhaka's date tomorrow
  await handover.getByLabel('Name of the place').fill('Dhanmondi Lake, near Rabindra Sarobar');
  await handover.getByLabel('Date and time (Dhaka time)').fill(`${tomorrow}T16:00`);
  await handover.getByRole('button', { name: 'Send the proposal' }).click();
  await expect(handover.getByRole('heading', { name: 'Your proposal' })).toBeVisible();
  await page.goto(orderPath);
  const sellerHandover = page.getByRole('region', { name: 'Meetup handover' });
  await sellerHandover.getByRole('button', { name: 'Accept' }).click();
  await expect(sellerHandover.getByText('A place and time are agreed.')).toBeVisible();

  // at the meetup the buyer checks the item and reads out the code; the seller enters it
  await shopper.reload();
  await handover.getByRole('button', { name: 'Show code' }).click();
  const spoken = await handover.getByText(/^\d( \d){5}$/).textContent();
  await sellerHandover.getByLabel("Buyer's code").fill(spoken!.replace(/ /g, ''));
  await sellerHandover.getByRole('button', { name: 'Confirm the handover' }).click();
  await expect(page.getByText(/^The item was delivered\. You are paid when the buyer confirms receipt/)).toBeVisible();
  await shopper.reload();
  await expect(handover.getByText('The item was handed over.')).toBeVisible();
  await shopper.getByRole('button', { name: 'Confirm you received the item' }).click();
  const release = shopper.getByRole('dialog', { name: 'Confirm you received the item' });
  await expect(release).toContainText('Releasing payment pays the seller ৳8,500 now and ends your right to dispute this order.');
  await release.getByRole('button', { name: 'Release ৳8,500 to the seller' }).click();
  await expect(shopper.getByText('Completed', { exact: true })).toBeVisible();
  await expect(shopper.getByText(/^Your payment of ৳8,500 was released to the seller on /)).toBeVisible();
  await expect(shopper.getByText('Payment received. Your money is held by TrustBazaar until you have the item.')).toHaveCount(0);
  await Promise.all([seller.close(), buyer.close(), operator.close()]);
});

test('SEC-SES-05 signing out on one tab ends the session in the other tabs too', async ({ browser }) => {
  const context = await browser.newContext(); // its own session, so the saved sign-ins of the other runs stay valid
  const first = await context.newPage();
  await signInMember(first, f.seller);
  const second = await context.newPage();
  await second.goto('/orders');
  await expect(second.getByRole('heading', { level: 1 })).toBeVisible();

  await first.goto('/account');
  await first.getByRole('button', { name: 'Sign out' }).click();
  await first.waitForURL((u) => !u.pathname.startsWith('/account'));

  // the other tab's next step finds the session ended and asks to sign in again
  await second.getByRole('link', { name: 'Notifications' }).click();
  await second.waitForURL((u) => u.pathname === '/signin' && u.searchParams.get('next') === '/notifications');
  await expect(second.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
  // and the old session cannot be brought back by refreshing
  expect((await second.request.post('/api/v1/auth/refresh', { headers: { origin: f.web } })).status()).toBeGreaterThanOrEqual(400);
  await context.close();
});

test('FR-AUC-11 FR-AUC-12 FR-AUC-13 IF-COM-02 two browsers bid live on one auction: each sees the other\'s bid and the outbid notice without reloading', async ({ browser }) => {
  const one = await browser.newContext({ storageState: state('buyer') });
  const two = await browser.newContext();
  const a = await one.newPage();
  const b = await two.newPage();
  await signInMember(b, f.bidder);
  await Promise.all([a.goto(`/listings/${f.auctionId}`), b.goto(`/listings/${f.auctionId}`)]);
  const panelA = a.getByRole('region', { name: 'Auction' });
  const panelB = b.getByRole('region', { name: 'Auction' });
  await expect(panelB.getByText('No bids yet.').first()).toBeVisible();

  await panelA.getByLabel('Your maximum bid (taka)').fill('1000');
  await panelA.getByRole('button', { name: 'Place bid' }).click();
  await panelA.getByRole('dialog', { name: 'Confirm your bid' }).getByRole('button', { name: 'Bid ৳1,000' }).click();
  await expect(panelA.getByText('You are leading at ৳1,000.')).toBeVisible();
  // the other browser sees the bid as it happens, with the new minimum
  await expect(panelB.getByText('Bids: 1')).toBeVisible();
  await expect(panelB.getByText('Minimum bid: ৳1,050')).toBeVisible();

  await panelB.getByLabel('Your maximum bid (taka)').fill('2000');
  await panelB.getByRole('button', { name: 'Place bid' }).click();
  await panelB.getByRole('dialog', { name: 'Confirm your bid' }).getByRole('button', { name: 'Bid ৳2,000' }).click();
  await expect(panelB.getByText('You are leading at ৳1,050.')).toBeVisible();
  // the first browser is told at once that it was outbid, with the new price, and no longer told it leads
  await expect(panelA.getByText('You have been outbid.').first()).toBeVisible();
  await expect(panelA.getByText('৳1,050', { exact: true })).toBeVisible();
  await expect(panelA.getByText('Bids: 2')).toBeVisible();
  await expect(panelA.getByText('Minimum bid: ৳1,100')).toBeVisible();
  await expect(panelA.getByText('You are leading at ৳1,000.')).toHaveCount(0);
  await expect(panelA.getByRole('region', { name: 'Bid history' }).getByRole('listitem')).toHaveCount(2);
  await Promise.all([one.close(), two.close()]);
});

test('FR-DSP-01 FR-DSP-06 FR-OPS-05 a dispute is decided in the console and, at BDT 20,000 or more, carried out only after a second operator approves', async ({ browser }) => {
  test.setTimeout(180_000);
  const buyer = await browser.newContext({ storageState: state('buyer') });
  const shopper = await buyer.newPage();
  await shopper.goto(`/listings/${f.disputeListingId}`);
  const orderPath = await buyWithMockBkash(shopper, '৳25,000');
  await expect(shopper.getByRole('region', { name: 'Open a dispute' })).toBeVisible({ timeout: 20_000 });
  await shopper.getByRole('region', { name: 'Open a dispute' }).getByRole('button', { name: 'Open a dispute' }).click();
  const dispute = shopper.getByRole('region', { name: 'Open a dispute' });
  await dispute.getByLabel('The item is not as described').check();
  await dispute.getByLabel('Describe the problem').fill('The lens has a deep scratch and fungus inside; the listing said no defects.');
  const chooser = shopper.waitForEvent('filechooser');
  await dispute.getByRole('button', { name: /^Photos/ }).click();
  await (await chooser).setFiles([photo(3)]);
  await dispute.getByRole('button', { name: 'Continue' }).click();
  const opening = shopper.getByRole('dialog', { name: 'Open a dispute' });
  await expect(opening).toContainText('Opening a dispute freezes the payment until TrustBazaar decides.');
  await opening.getByRole('button', { name: 'Open the dispute' }).click();
  await expect(shopper.getByText(/^Your payment of ৳25,000 is frozen while TrustBazaar reviews your dispute\./)).toBeVisible();
  const disputeId = await shopper.evaluate(async (path) => {
    const r = await fetch(`/api/v1${path}/disputes`, { credentials: 'same-origin' });
    return ((await r.json()) as { items: { id: string }[] }).items[0].id;
  }, orderPath);

  // the seller answers with a statement
  const sellerContext = await browser.newContext();
  const seller = await sellerContext.newPage();
  await signInMember(seller, f.seller);
  await seller.goto(orderPath);
  const sellerSide = seller.getByRole('region', { name: 'Dispute: The item is not as described' });
  await sellerSide.getByLabel('Your response').fill('The camera was checked before listing; the photos show the lens was clean.');
  await sellerSide.getByRole('button', { name: 'Send the response' }).click();
  await expect(sellerSide.getByText('The camera was checked before listing; the photos show the lens was clean.')).toBeVisible();

  // the first operator claims the case and decides a full refund
  const first = await staff(browser, 'operator');
  const op = await first.newPage();
  await op.goto('/staff/queues/disputes');
  await op.getByRole('button', { name: `Claim ${disputeId.slice(0, 8)}` }).click();
  await op.getByRole('link', { name: `Open ${disputeId.slice(0, 8)}` }).click();
  await expect(op.getByRole('heading', { name: `Dispute ${disputeId.slice(0, 8)}` })).toBeVisible();
  const decide = op.getByRole('form', { name: 'Decide the dispute' });
  await expect(decide.getByText("This decision needs a second operator's approval.")).toBeVisible();
  await decide.getByLabel('Refund the buyer in full').check();
  await decide.getByLabel('Reason (recorded with the action)').fill('The buyer\'s photo shows fungus in the lens; the listing declared no defects.');
  await decide.getByRole('button', { name: 'Decide' }).click();
  await op.getByRole('dialog', { name: 'Decide the dispute' }).getByRole('button', { name: 'Decide' }).click();
  const ref = `dispute ${disputeId.slice(0, 8)}`;
  // the proposer cannot approve it: it is not among their approvals
  await op.goto('/staff/approvals');
  await expect(op.getByRole('heading', { name: 'Approvals', level: 1 })).toBeVisible();
  await expect(op.getByRole('listitem').filter({ hasText: ref })).toHaveCount(0);

  // a second operator approves, and the refund is carried out
  const secondContext = await browser.newContext();
  const op2 = await secondContext.newPage();
  await signInStaff(op2, f.operator2);
  await op2.goto('/staff/approvals');
  const proposal = op2.getByRole('listitem').filter({ hasText: ref });
  await expect(proposal.getByRole('heading', { name: 'Dispute decision of ৳20,000 or more' })).toBeVisible();
  await expect(proposal).toContainText('full_refund');
  await proposal.getByLabel('Note (optional)').fill('Agree: the photo shows fungus.');
  await proposal.getByRole('button', { name: 'Approve' }).click();
  await proposal.getByRole('dialog', { name: 'Approve: Dispute decision of ৳20,000 or more?' }).getByRole('button', { name: 'Approve' }).click();
  await expect(op2.getByRole('listitem').filter({ hasText: ref })).toHaveCount(0);

  // the buyer sees the decision and the refund; the seller sees the outcome too
  await shopper.reload();
  await expect(shopper.getByText('Completed', { exact: true })).toBeVisible();
  await expect(shopper.getByText(/^You were refunded ৳25,000 on /)).toBeVisible();
  const decided = shopper.getByRole('region', { name: 'Dispute: The item is not as described' });
  await expect(decided.getByText('The buyer is refunded in full.')).toBeVisible();
  await expect(decided.getByText("Reason: The buyer's photo shows fungus in the lens; the listing declared no defects.")).toBeVisible();
  await seller.reload();
  await expect(sellerSide.getByText('The buyer is refunded in full.')).toBeVisible();
  await Promise.all([buyer.close(), sellerContext.close(), first.close(), secondContext.close()]);
});

test('FR-GAM-05 FR-GAM-07 FR-GAM-10 FR-GAM-13 SEC-GAM-01 the sealed game-account handover between two browsers: the buyer\'s key, the seller seals, the buyer opens', async ({ browser }) => {
  test.setTimeout(180_000);
  const buyer = await browser.newContext({ storageState: state('buyer') });
  const shopper = await buyer.newPage();
  await shopper.goto(`/listings/${f.gameListingId}`);
  await shopper.getByRole('link', { name: 'Buy now for ৳2,500' }).click();
  await expect(shopper.getByText(/^Use this same browser on this device to open the credentials\./)).toBeVisible();
  await shopper.getByRole('button', { name: 'Continue to payment' }).click();
  await expect(shopper.getByText('Waiting for payment')).toBeVisible();
  const orderPath = new URL(shopper.url()).pathname;
  const orderId = orderPath.split('/').pop()!;

  // the publisher-risk notice is acknowledged, then the key is created in this browser on the strict page
  await shopper.getByLabel(/^I have read this/).check();
  await shopper.getByRole('button', { name: 'Confirm' }).click();
  await shopper.getByRole('link', { name: 'Create the key in this browser' }).click();
  await shopper.waitForURL(`**/secure/orders/${orderId}/key`);
  await shopper.getByRole('button', { name: 'Create the key in this browser' }).click();
  await expect(shopper.getByText('Your key is created. You can go back to the order and pay.')).toBeVisible();
  const fingerprint = await shopper.getByText(/^[0-9a-f]{4}(-[0-9a-f]{4}){4}$/).textContent();
  await shopper.getByRole('link', { name: 'Back to the order' }).click();
  await expect(shopper.getByText('Your key is ready in this browser. You can pay now.')).toBeVisible();
  await payWithMockBkash(shopper, '৳2,500');

  // the seller is asked for the login details and seals them in their own browser for the buyer's key
  const sellerContext = await browser.newContext();
  const seller = await sellerContext.newPage();
  await signInMember(seller, f.seller);
  await seller.goto(orderPath);
  await seller.getByRole('link', { name: 'Send the login details' }).click({ timeout: 20_000 }); // once the paid event is handled
  await seller.waitForURL(`**/secure/orders/${orderId}/deliver`);
  // the seller sees the same fingerprint as the buyer's browser before sending
  await expect(seller.getByRole('region', { name: "The buyer's key" }).getByText(fingerprint!, { exact: true })).toBeVisible();
  await seller.getByLabel('Login (e-mail, phone or user name)').fill('division1.player@example.com');
  await seller.getByLabel('Password', { exact: true }).fill('Correct-Horse-Battery-9');
  await seller.getByLabel('Recovery or backup codes').fill('8F2K-11QX\n9Z3M-22RW');
  await seller.getByLabel('A note for the buyer').fill('Not linked to any phone number.');
  const delivered = seller.waitForResponse((r) => r.url().includes(`/orders/${orderId}/game/`) && r.request().method() === 'POST');
  await seller.getByRole('button', { name: 'Lock and send' }).click();
  const body = (await delivered).request().postData() ?? '';
  expect(body).not.toContain('Correct-Horse-Battery-9'); // only the sealed form leaves the seller's browser
  expect(body).not.toContain('division1.player@example.com');
  await expect(seller.getByText('The login details are sent. Nothing you typed is kept in this page.')).toBeVisible();

  // the buyer opens them in the same browser that holds the key
  await shopper.goto(orderPath);
  await shopper.getByRole('link', { name: 'Open the login details' }).click({ timeout: 20_000 });
  const details = shopper.getByRole('region', { name: 'Login details' });
  await expect(details.getByRole('definition').filter({ hasText: 'division1.player@example.com' })).toBeVisible();
  await expect(details.getByRole('definition').filter({ hasText: 'Correct-Horse-Battery-9' })).toBeVisible();
  await expect(details.getByRole('listitem')).toHaveText(['8F2K-11QX', '9Z3M-22RW']);
  await expect(shopper.getByRole('button', { name: 'Done: Change the password' })).toBeVisible();

  // the same buyer in another browser, without the key, cannot read them
  const elsewhere = await browser.newContext({ storageState: state('buyer') });
  const other = await elsewhere.newPage();
  await other.goto(`/secure/orders/${orderId}/credentials`);
  await expect(other.getByRole('alert')).toHaveText('This browser does not have the key for these login details.');
  await expect(other.getByText('Correct-Horse-Battery-9')).toHaveCount(0);
  await expect(other.getByRole('button', { name: 'Create a new key and ask again' })).toBeVisible();
  await Promise.all([buyer.close(), sellerContext.close(), elsewhere.close()]);
});
