import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 6, for Unit 2's U2-06 (Decisions log, 2026-11-17). Runs as tb_owner (SEC-INF-03).
//   FR-MON-06, FR-MON-08: the Pro Seller's notices on payments.subscription.changed. When a paid month ends without
//   a renewal the subscription is past due: the seller is reminded to pay the next month (wallets cannot be charged
//   automatically). After a second missed or failed renewal it lapses and the seller is told they are back on
//   standard terms. In the app and by e-mail (category transaction). The texts are a draft for the team's review; a
//   corrected text is a new version, never an edit of this migration.
export class ProSellerTemplates1793491200030 implements MigrationInterface {
  name = 'ProSellerTemplates1793491200030';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(String.raw`
INSERT INTO notify.templates (code, version, category, channels, allowed_params, title_en, title_bn, body_en, body_bn) VALUES
 ('payment.pro_renewal_due', 1, 'transaction', '{email}', '{amount_bdt}',
  'Your Pro Seller month has ended', 'আপনার প্রো সেলার মাস শেষ হয়েছে',
  'Your paid Pro Seller month has ended. Pay BDT {amount_bdt} for the next month to keep the lower commission and the higher listing limit. Until you pay, new orders use the standard rate.',
  'আপনার প্রো সেলার মাসের মেয়াদ শেষ হয়েছে। কম কমিশন ও বেশি বিজ্ঞাপনের সীমা রাখতে পরের মাসের জন্য {amount_bdt} টাকা পরিশোধ করুন। পরিশোধ না করা পর্যন্ত নতুন অর্ডারে সাধারণ হার প্রযোজ্য।'),
 ('payment.pro_lapsed', 1, 'transaction', '{email}', '{}',
  'Your Pro Seller subscription has lapsed', 'আপনার প্রো সেলার সাবস্ক্রিপশন বাতিল হয়েছে',
  'Your Pro Seller subscription has lapsed after two missed renewals. You are back on standard terms: listings above the standard limit stay active until they end, but you cannot publish new ones while you are over it. You can subscribe again at any time.',
  'পরপর দুইবার নবায়ন না হওয়ায় আপনার প্রো সেলার সাবস্ক্রিপশন বাতিল হয়েছে। আপনি এখন সাধারণ শর্তে আছেন: সাধারণ সীমার বেশি বিজ্ঞাপনগুলো শেষ না হওয়া পর্যন্ত চালু থাকবে, তবে সীমার বেশি থাকা অবস্থায় নতুন বিজ্ঞাপন প্রকাশ করা যাবে না। যেকোনো সময় আবার সাবস্ক্রাইব করতে পারেন।');`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM notify.notifications WHERE template_code IN ('payment.pro_renewal_due', 'payment.pro_lapsed') AND template_version = 1;
      DELETE FROM notify.templates WHERE code IN ('payment.pro_renewal_due', 'payment.pro_lapsed') AND version = 1;`);
  }
}
