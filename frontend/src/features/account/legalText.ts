// The terms and conditions a new member accepts (FR-ACC-04; U10-25), in both languages. Written to say only what the system does (the SRS rules named
// in PROGRESS.md, Decisions log U10-25) and to leave no gap between the member's duties and ours. A draft for the team's and a lawyer's review before
// real money moves (U8-02); the version in legal.ts must change with any change of this text, so every new member accepts the current one.
interface LegalSection {
  title: string;
  clauses: string[];
}

export interface LegalText {
  intro: string;
  sections: LegalSection[];
}

const en: LegalText = {
  intro:
    'These terms are the agreement between you and TrustBazaar. Read them before you create an account. By ticking the box you confirm that you have read them, that you understand them and that you accept them.',
  sections: [
    {
      title: 'The agreement',
      clauses: [
        'These terms, the privacy notice and the rules shown on the site at the time you act (the listing rules, the prohibited categories, the fees and the times shown on an order) are the whole agreement between you and TrustBazaar. A rule shown on the site binds you as these terms do.',
        'We may change these terms. A change takes effect when we publish the new version and you accept it; until you accept it you may be unable to buy, bid or sell. An order already placed stays under the terms and the rates that applied when it was placed.',
        'Nobody at TrustBazaar, and no seller or buyer, can change these terms by a message, a call or a promise in chat. Only the published version counts.',
      ],
    },
    {
      title: 'Who may use TrustBazaar',
      clauses: [
        'You must be 18 or older. By accepting these terms you confirm your age. We may close an account that was opened by someone younger.',
        'You may have one account. You must give true details (your name, your own mobile number and your own e-mail address) and keep them current. A person, a number, an e-mail address and an identity document may each belong to one open account only.',
        'To buy, bid or sell you must pass identity verification with your own national identity document and a selfie. A false, borrowed, altered or stolen document, or a second account to get round a refusal, is a serious breach of these terms.',
        'Your account is yours alone. Do not sell, lend, share or give it to anyone. Keep your password secret. You are responsible for everything done through your account until you tell us it was compromised and we have had reasonable time to act. We may ask for a code sent to your e-mail address when you sign in, and we may ask you to confirm sensitive actions again.',
      ],
    },
    {
      title: 'What TrustBazaar is, and what it is not',
      clauses: [
        'TrustBazaar is a marketplace. A sale is a contract between a buyer and a seller. TrustBazaar is not the seller, does not own, inspect, store or guarantee any item and does not promise that a listing is true. Our part is limited to what these terms say: holding the payment, running the handover steps, deciding disputes and enforcing the rules.',
        'Our protection applies only to an order made, paid and carried out through TrustBazaar, within the times shown on the order.',
      ],
    },
    {
      title: 'Listings',
      clauses: [
        'A seller must own the item or be allowed to sell it, describe it truthfully (its kind, condition, faults, accessories and any repair), and show photographs of the actual item. A seller must be able to hand the item over as listed.',
        'You may not list anything on our list of prohibited categories: weapons and ammunition; drugs and controlled medicines; alcohol and tobacco; stolen goods; counterfeit or replica goods; government-issued documents; SIM cards registered to another person; live animals; adult content; and accounts other than game accounts (for example social-media, banking or mobile-money accounts). Anything else the listing rules forbid is also prohibited.',
        'We may check, hold, change or remove a listing, and may use automatic checks of its text and pictures. A listing held for review is not published until staff decide.',
        'The commission and the delivery margin are shown to the seller before the listing is created, and the full price to the buyer before payment.',
      ],
    },
    {
      title: 'Buying, paying and escrow',
      clauses: [
        "Pay only through TrustBazaar, with the payment services it offers. You enter your wallet PIN or card details only on the payment provider's own page. TrustBazaar will never ask you for a PIN, a password or a code, by chat, call or e-mail.",
        "When you pay, the money is held by TrustBazaar (escrow) and is not the seller's until it is released under these terms. The total, with any delivery fee, is shown before you pay.",
        'Until the delivery event, a buyer may ask to cancel and the seller may agree, and the seller may cancel alone; either way the buyer is refunded in full. If the step the order needs from the seller is not recorded by its deadline, the order is cancelled and the buyer is refunded in full. A seller who cancels alone after payment, or misses a deadline, receives a strike.',
        'A refund goes back to the payment method used. A payment provider may take time to complete it.',
      ],
    },
    {
      title: 'Only on TrustBazaar',
      clauses: [
        'Do not ask for, offer or take payment outside TrustBazaar for an item listed here, and do not move a deal out of the app to avoid its rules or fees. Protection, refunds and dispute decisions do not cover anything paid or agreed outside TrustBazaar.',
        'We may check messages and listings automatically for contact details, outside payment and signs of fraud, and staff may read a message that is reported or flagged. A warning shown in a chat is a warning, not an offer of protection.',
      ],
    },
    {
      title: 'Handover and delivery',
      clauses: [
        'For a meeting in person, use a public place. Check the item before you give the handover code. Giving the code to the seller tells TrustBazaar that you received the item. Never give the code before you have the item in your hands, and never give it to anyone but the seller you are meeting.',
        "A seller must not hand an item over until the payment shows as held on the order. The seller may photograph the item at the handover, and may be asked to; these photographs are kept as evidence and removed when the order's disputes are over, as the privacy notice says. For a device with an identifier (such as an IMEI or serial number), the buyer may be asked to enter it at the handover, and the seller to check it on a return.",
        "For delivery by courier, the delivery fee is shown before payment. A courier's delay, loss or damage is dealt with under the order's times and the dispute rules. If the courier returns the item to the seller, the order is cancelled and the buyer is refunded in full, including the delivery fee.",
      ],
    },
    {
      title: 'When the seller is paid',
      clauses: [
        'The money is released to the seller only when the buyer confirms receipt, or when the automatic-release time shown on the order ends with no dispute open. That time is counted from the delivery event, never from payment. A buyer who does not confirm and does not open a dispute in time is treated as satisfied.',
        "Money is paid out to the seller's own verified payout account only. The commission, and any fee owed, is taken from the seller's payout.",
        'After the money is released or refunded, no dispute can be opened on that order. A later complaint is handled as a report and may lead to a sanction, not to a refund.',
      ],
    },
    {
      title: 'Bids and auctions',
      clauses: [
        'A bid is binding and cannot be withdrawn. Staff may cancel a bid only on evidence of fraud or of a compromised account, and write down the reason.',
        "An auction ends on TrustBazaar's clock, not yours. The highest valid bid at the end wins. A bid arriving after the end is not counted. A seller, or anyone for a seller, may not bid on the seller's own listing or push the price up in any other way.",
        'A winner who does not pay receives a strike. After the number of strikes set by us, the person is suspended from bidding for a period, and is told why.',
      ],
    },
    {
      title: 'Disputes and returns',
      clauses: [
        'If an order goes wrong, a buyer must open a dispute before the deadline shown on the order. Only one dispute can be open on an order at a time. While it is open, the money stays held.',
        'Both sides may give evidence. Staff decide from that evidence and write down the reason: release to the seller, a full refund to the buyer, or a partial refund. A partial refund is taken from the item price first. Evidence must be true and your own. Forged, altered or borrowed evidence is a serious breach of these terms.',
        'Where a buyer returns an item, the seller must check the returned item (for a device, its identifier) before recording it as received. A buyer receives a strike only when staff find bad faith in a decided dispute: a false claim, when the seller was paid in full, or a swap of the returned item for another. Losing a dispute, withdrawing it or being refunded is never a strike. A swap suspends buying and bidding at once, pending review, and may lead to a blacklist. A seller receives a strike for losing a dispute.',
        'Our decision settles who receives the held money. It does not take away rights you have under the law.',
      ],
    },
    {
      title: 'Game accounts',
      clauses: [
        "The game's publisher may prohibit the transfer of an account and may suspend or ban it. TrustBazaar's protection covers the handover, the takeover and the seller's recovery of the account during the protection period. It does not cover anything the publisher does. A buyer must confirm that they understand this before paying.",
        "The seller's login details are asked for only after the payment is held, within the time shown on the order; if they are not given, the order is cancelled and the buyer is refunded in full. The money stays held during the protection period after the takeover and is released when it ends, or earlier if the buyer chooses, unless a dispute is open.",
        "A seller who takes back, resets, uses or sells again an account after selling it commits a serious breach. When staff confirm it, the seller is suspended, the seller's identity document is added to the blacklist, and the order's evidence may be given to the police.",
      ],
    },
    {
      title: 'Fees and taxes',
      clauses: [
        'The seller pays a commission, as a percentage of the item price, on each sale, charged only on the part of the price that is released to the seller. The rates in force when an order is created apply to it. Delivery, featured listings and a Pro Seller subscription have the fees shown when you choose them.',
        'You are responsible for your own taxes. TrustBazaar does not give tax advice.',
      ],
    },
    {
      title: 'Your conduct',
      clauses: [
        "You may not: deceive, threaten, harass or abuse anyone; send spam; manipulate ratings or bids; open accounts with false or another person's details; get round identity verification, limits or a suspension; use another person's account; collect data from the site by automatic means; probe, attack or overload the service; or encourage or help anyone to do these things.",
        'If you see a listing, a person or a message that breaks these terms, report it. We review reports.',
      ],
    },
    {
      title: 'Warnings, limits and closing',
      clauses: [
        'If you break these terms or the rules, we may, according to how serious it is: remove a listing, cancel a bid or an order, hold a payout while we investigate, limit or suspend what your account can do, close the account, and add an identity document to the blacklist. We will normally tell you why.',
        'You may close your account at any time once your open orders, disputes and money owed are settled. Closing does not cancel what you owe or end our right to keep records the law and the privacy notice allow.',
      ],
    },
    {
      title: 'Responsibility',
      clauses: [
        "As far as the law allows, TrustBazaar is not responsible for: an item's quality, safety or legality; what a seller, a buyer, a courier, a payment provider or a game publisher does or fails to do; a loss caused by an account you did not protect; a service interruption we could not prevent; or a loss of profit, chance or other indirect loss.",
        'As far as the law allows, our total responsibility for an order is limited to the amount that order held with us. Nothing in these terms limits a responsibility that the law does not allow to be limited, such as for fraud.',
        'You must repay us for a loss, cost or claim caused by your breach of these terms, by a prohibited or false listing, or by your unlawful act.',
      ],
    },
    {
      title: 'Test version',
      clauses: [
        'This version of TrustBazaar is a university project. Payments, couriers and messages from payment providers are simulated, and no real money moves. Nothing here creates a real payment duty or a right to real goods or money while this is so. The rules above describe how the service works and are applied as written.',
      ],
    },
    {
      title: 'General',
      clauses: [
        'We send notices to the e-mail address and the number on your account and to your account inside TrustBazaar; you must keep them current. A notice sent there is treated as received.',
        'The law of Bangladesh governs these terms, and the courts of Dhaka may decide a dispute about them, without taking away any right you have under the law to go elsewhere.',
        'If part of these terms is found unenforceable, the rest stays in force. If we do not enforce a term at once, we may still enforce it later. You may not transfer your rights under these terms.',
        'These terms are published in Bangla and in English. If the two differ, the English text applies.',
      ],
    },
  ],
};

const bn: LegalText = {
  intro:
    'এই শর্তাবলি আপনার ও TrustBazaar-এর মধ্যকার চুক্তি। অ্যাকাউন্ট খোলার আগে এগুলো পড়ুন। ঘরটিতে টিক দিয়ে আপনি নিশ্চিত করছেন যে আপনি এগুলো পড়েছেন, বুঝেছেন এবং মেনে নিচ্ছেন।',
  sections: [
    {
      title: 'চুক্তি',
      clauses: [
        'এই শর্তাবলি, গোপনীয়তা নোটিশ এবং আপনি যখন কিছু করেন তখন সাইটে দেখানো নিয়মগুলো (লিস্টিংয়ের নিয়ম, নিষিদ্ধ ধরন, ফি এবং অর্ডারে দেখানো সময়) মিলে আপনার ও TrustBazaar-এর সম্পূর্ণ চুক্তি। সাইটে দেখানো নিয়ম এই শর্তের মতোই আপনার জন্য বাধ্যতামূলক।',
        'আমরা এই শর্ত বদলাতে পারি। নতুন সংস্করণ প্রকাশ করে আপনি তা মেনে নিলে বদল কার্যকর হয়; মেনে না নেওয়া পর্যন্ত আপনি কিনতে, বিড করতে বা বিক্রি করতে নাও পারেন। আগে দেওয়া অর্ডার সেই সময়ের শর্ত ও হারেই চলবে।',
        'TrustBazaar-এর কেউ, বা কোনো বিক্রেতা বা ক্রেতা, বার্তা, ফোন বা চ্যাটের প্রতিশ্রুতিতে এই শর্ত বদলাতে পারেন না। কেবল প্রকাশিত সংস্করণই গণ্য।',
      ],
    },
    {
      title: 'কারা TrustBazaar ব্যবহার করতে পারেন',
      clauses: [
        'আপনার বয়স ১৮ বা তার বেশি হতে হবে। শর্ত মেনে নিয়ে আপনি বয়সের কথা নিশ্চিত করছেন। কম বয়সী কেউ খুললে আমরা সেই অ্যাকাউন্ট বন্ধ করতে পারি।',
        'আপনি একটিই অ্যাকাউন্ট রাখতে পারবেন। সঠিক তথ্য (আপনার নাম, আপনার নিজের মোবাইল নম্বর ও নিজের ই-মেইল) দিতে হবে এবং হালনাগাদ রাখতে হবে। একজন ব্যক্তি, একটি নম্বর, একটি ই-মেইল ও একটি পরিচয়পত্র কেবল একটি চালু অ্যাকাউন্টের হতে পারে।',
        'কিনতে, বিড করতে বা বিক্রি করতে আপনার নিজের জাতীয় পরিচয়পত্র ও সেলফি দিয়ে পরিচয় যাচাই করতে হবে। ভুয়া, ধার করা, বদলানো বা চুরি করা পরিচয়পত্র, কিংবা প্রত্যাখ্যান এড়াতে দ্বিতীয় অ্যাকাউন্ট খোলা এই শর্তের গুরুতর লঙ্ঘন।',
        'আপনার অ্যাকাউন্ট কেবল আপনার। এটি কাউকে বিক্রি, ধার, ভাগ বা দান করবেন না। পাসওয়ার্ড গোপন রাখুন। অ্যাকাউন্ট ঝুঁকিতে পড়েছে বলে আমাদের জানানোর পর আমরা যুক্তিসংগত সময় না পাওয়া পর্যন্ত আপনার অ্যাকাউন্ট দিয়ে করা সবকিছুর দায় আপনার। সাইন-ইনের সময় আমরা আপনার ই-মেইলে কোড পাঠিয়ে চাইতে পারি, এবং সংবেদনশীল কাজ আবার নিশ্চিত করতে বলতে পারি।',
      ],
    },
    {
      title: 'TrustBazaar কী, আর কী নয়',
      clauses: [
        'TrustBazaar একটি বাজার। বিক্রি হলো ক্রেতা ও বিক্রেতার মধ্যকার চুক্তি। TrustBazaar বিক্রেতা নয়; কোনো জিনিসের মালিক নয়, তা পরীক্ষা, সংরক্ষণ বা নিশ্চয়তা দেয় না, এবং কোনো লিস্টিং সত্য বলেও প্রতিশ্রুতি দেয় না। আমাদের ভূমিকা এই শর্তে যা লেখা আছে ততটুকুই: টাকা জমা রাখা, হস্তান্তরের ধাপ চালানো, বিরোধের সিদ্ধান্ত দেওয়া এবং নিয়ম প্রয়োগ করা।',
        'আমাদের সুরক্ষা কেবল সেই অর্ডারে প্রযোজ্য যা TrustBazaar-এর মাধ্যমে দেওয়া, পরিশোধ করা ও সম্পন্ন হয়েছে, এবং অর্ডারে দেখানো সময়ের মধ্যে।',
      ],
    },
    {
      title: 'লিস্টিং',
      clauses: [
        'বিক্রেতাকে জিনিসটির মালিক বা বিক্রির অনুমতিপ্রাপ্ত হতে হবে, সেটির ধরন, অবস্থা, ত্রুটি, আনুষঙ্গিক জিনিস ও মেরামতের কথা সত্যভাবে লিখতে হবে এবং আসল জিনিসটির ছবি দিতে হবে। লিস্টিংয়ে যেমন আছে তেমন জিনিস হস্তান্তর করতে সক্ষম থাকতে হবে।',
        'নিষিদ্ধ তালিকার কিছু লিস্ট করা যাবে না: অস্ত্র ও গোলাবারুদ; মাদক ও নিয়ন্ত্রিত ওষুধ; মদ ও তামাক; চুরি করা জিনিস; নকল বা প্রতিরূপ জিনিস; সরকারি পরিচয় বা নথি; অন্যের নামে নিবন্ধিত সিম; জীবন্ত প্রাণী; প্রাপ্তবয়স্ক বিষয়বস্তু; এবং গেম অ্যাকাউন্ট ছাড়া অন্য অ্যাকাউন্ট (যেমন সোশ্যাল মিডিয়া, ব্যাংক বা মোবাইল ব্যাংকিং অ্যাকাউন্ট)। লিস্টিংয়ের নিয়মে নিষিদ্ধ অন্য সবকিছুও নিষিদ্ধ।',
        'আমরা কোনো লিস্টিং পরীক্ষা, আটকে রাখা, বদল বা সরিয়ে দিতে পারি এবং এর লেখা ও ছবিতে স্বয়ংক্রিয় যাচাই চালাতে পারি। পর্যালোচনার জন্য আটকে রাখা লিস্টিং কর্মীদের সিদ্ধান্ত না হওয়া পর্যন্ত প্রকাশ হয় না।',
        'লিস্টিং তৈরির আগে বিক্রেতাকে কমিশন ও ডেলিভারি মার্জিন, এবং টাকা দেওয়ার আগে ক্রেতাকে পূর্ণ দাম দেখানো হয়।',
      ],
    },
    {
      title: 'কেনা, পেমেন্ট ও এসক্রো',
      clauses: [
        'কেবল TrustBazaar-এর মাধ্যমে, এর দেওয়া পেমেন্ট সেবায় টাকা দিন। ওয়ালেটের পিন বা কার্ডের তথ্য শুধু পেমেন্ট সেবাদাতার নিজের পাতায় দিন। TrustBazaar কখনও চ্যাট, ফোন বা ই-মেইলে পিন, পাসওয়ার্ড বা কোড চাইবে না।',
        'আপনি টাকা দিলে তা TrustBazaar জমা রাখে (এসক্রো) এবং এই শর্ত অনুযায়ী ছাড়ার আগে তা বিক্রেতার হয় না। টাকা দেওয়ার আগে ডেলিভারি ফিসহ মোট দাম দেখানো হয়।',
        'ডেলিভারির আগে ক্রেতা বাতিলের অনুরোধ করতে পারেন ও বিক্রেতা রাজি হতে পারেন, এবং বিক্রেতা একাই বাতিল করতে পারেন; দুই ক্ষেত্রেই ক্রেতা পুরো টাকা ফেরত পান। বিক্রেতার যে ধাপ অর্ডারে লাগে তা নির্ধারিত সময়ের মধ্যে নথিভুক্ত না হলে অর্ডার বাতিল হয় এবং ক্রেতা পুরো টাকা ফেরত পান। পেমেন্টের পর একা বাতিল করলে বা সময় পার করলে বিক্রেতা একটি স্ট্রাইক পান।',
        'ফেরত যায় যে পদ্ধতিতে টাকা দেওয়া হয়েছিল সেখানেই। পেমেন্ট সেবাদাতার তা শেষ করতে সময় লাগতে পারে।',
      ],
    },
    {
      title: 'কেবল TrustBazaar-এ',
      clauses: [
        'এখানে লিস্ট করা জিনিসের জন্য TrustBazaar-এর বাইরে টাকা চাইবেন না, দেবেন না বা নেবেন না, এবং নিয়ম বা ফি এড়াতে লেনদেন অ্যাপের বাইরে নেবেন না। TrustBazaar-এর বাইরে দেওয়া বা ঠিক করা কিছুতে সুরক্ষা, ফেরত ও বিরোধের সিদ্ধান্ত প্রযোজ্য নয়।',
        'যোগাযোগের তথ্য, বাইরের পেমেন্ট ও প্রতারণার লক্ষণের জন্য আমরা বার্তা ও লিস্টিং স্বয়ংক্রিয়ভাবে পরীক্ষা করতে পারি, এবং অভিযোগ করা বা চিহ্নিত বার্তা কর্মীরা পড়তে পারেন। চ্যাটে দেখানো সতর্কতা কেবল সতর্কতা, সুরক্ষার প্রতিশ্রুতি নয়।',
      ],
    },
    {
      title: 'হস্তান্তর ও ডেলিভারি',
      clauses: [
        'সামনাসামনি দেখা করলে জনসমাগমের জায়গা বেছে নিন। হস্তান্তরের কোড দেওয়ার আগে জিনিস দেখে নিন। বিক্রেতাকে কোড দেওয়ার মানে আপনি জিনিসটি পেয়েছেন বলে TrustBazaar-কে জানানো। জিনিস হাতে পাওয়ার আগে কোড দেবেন না, এবং যাঁর সঙ্গে দেখা করছেন সেই বিক্রেতা ছাড়া কাউকে দেবেন না।',
        'অর্ডারে পেমেন্ট জমা দেখানো না পর্যন্ত বিক্রেতা জিনিস হস্তান্তর করবেন না। হস্তান্তরের সময় বিক্রেতা জিনিসের ছবি তুলতে পারেন, এবং তুলতে বলা হতে পারে; এই ছবি প্রমাণ হিসেবে রাখা হয় এবং গোপনীয়তা নোটিশ অনুযায়ী অর্ডারের বিরোধ শেষ হলে মুছে ফেলা হয়। শনাক্তকারী আছে এমন ডিভাইসে (যেমন IMEI বা সিরিয়াল নম্বর) ক্রেতাকে হস্তান্তরের সময় তা লিখতে, এবং ফেরতের সময় বিক্রেতাকে তা মিলিয়ে দেখতে বলা হতে পারে।',
        'কুরিয়ারে ডেলিভারির ডেলিভারি ফি টাকা দেওয়ার আগে দেখানো হয়। কুরিয়ারের দেরি, হারানো বা ক্ষতি অর্ডারের সময় ও বিরোধের নিয়মে নিষ্পত্তি হয়। কুরিয়ার জিনিস বিক্রেতার কাছে ফেরত দিলে অর্ডার বাতিল হয় এবং ক্রেতা ডেলিভারি ফিসহ পুরো টাকা ফেরত পান।',
      ],
    },
    {
      title: 'বিক্রেতা কখন টাকা পান',
      clauses: [
        'ক্রেতা পাওয়া নিশ্চিত করলে, অথবা কোনো বিরোধ খোলা না থেকে অর্ডারে দেখানো স্বয়ংক্রিয় ছাড়ের সময় শেষ হলে, তবেই টাকা বিক্রেতাকে ছাড়া হয়। সময় গোনা হয় ডেলিভারির ঘটনা থেকে, পেমেন্ট থেকে নয়। যে ক্রেতা নিশ্চিত করেন না এবং সময়মতো বিরোধও খোলেন না, তাঁকে সন্তুষ্ট ধরা হয়।',
        'টাকা কেবল বিক্রেতার নিজের যাচাইকৃত পেআউট অ্যাকাউন্টে যায়। কমিশন ও অন্য পাওনা ফি বিক্রেতার পেআউট থেকে কেটে নেওয়া হয়।',
        'টাকা ছাড়া বা ফেরত দেওয়ার পর সেই অর্ডারে আর বিরোধ খোলা যায় না। পরের অভিযোগ রিপোর্ট হিসেবে দেখা হয় এবং তাতে ফেরত নয়, শাস্তি হতে পারে।',
      ],
    },
    {
      title: 'বিড ও নিলাম',
      clauses: [
        'বিড বাধ্যতামূলক এবং তুলে নেওয়া যায় না। কর্মীরা কেবল প্রতারণা বা ঝুঁকিতে পড়া অ্যাকাউন্টের প্রমাণ থাকলে বিড বাতিল করতে পারেন এবং কারণ লিখে রাখেন।',
        'নিলাম শেষ হয় TrustBazaar-এর ঘড়িতে, আপনার ঘড়িতে নয়। শেষে সর্বোচ্চ বৈধ বিড জেতে। শেষের পরে আসা বিড গণ্য হয় না। বিক্রেতা, বা বিক্রেতার হয়ে কেউ, নিজের লিস্টিংয়ে বিড করতে বা অন্য কোনোভাবে দাম বাড়াতে পারবেন না।',
        'যে বিজয়ী টাকা দেন না তিনি একটি স্ট্রাইক পান। আমাদের নির্ধারিত সংখ্যায় পৌঁছালে তাঁকে কিছুদিনের জন্য বিড করা থেকে স্থগিত করা হয় এবং কারণ জানানো হয়।',
      ],
    },
    {
      title: 'বিরোধ ও ফেরত',
      clauses: [
        'কোনো অর্ডারে সমস্যা হলে ক্রেতাকে অর্ডারে দেখানো সময়সীমার আগে বিরোধ খুলতে হবে। একটি অর্ডারে একসঙ্গে একটিই বিরোধ খোলা থাকতে পারে। খোলা থাকাকালে টাকা জমাই থাকে।',
        'দুই পক্ষই প্রমাণ দিতে পারেন। কর্মীরা সেই প্রমাণ দেখে সিদ্ধান্ত নেন এবং কারণ লিখে রাখেন: বিক্রেতাকে ছাড়, ক্রেতাকে পুরো ফেরত, বা আংশিক ফেরত। আংশিক ফেরত আগে পণ্যের দাম থেকে নেওয়া হয়। প্রমাণ সত্য ও আপনার নিজের হতে হবে। জাল, বদলানো বা ধার করা প্রমাণ এই শর্তের গুরুতর লঙ্ঘন।',
        'ক্রেতা জিনিস ফেরত দিলে বিক্রেতাকে ফেরত আসা জিনিসটি (ডিভাইসের ক্ষেত্রে তার শনাক্তকারী) পরীক্ষা করে তবে পাওয়া হিসেবে নথিভুক্ত করতে হবে। কেবল তখনই ক্রেতা স্ট্রাইক পান যখন কর্মীরা সিদ্ধান্ত হওয়া কোনো বিরোধে অসদুদ্দেশ্য পান: মিথ্যা দাবি, যখন বিক্রেতা পুরো টাকা পেয়েছেন; অথবা ফেরত দেওয়া জিনিস অন্য জিনিসে বদলে দেওয়া। বিরোধে হেরে যাওয়া, তা তুলে নেওয়া বা টাকা ফেরত পাওয়া কখনও স্ট্রাইক নয়। বদল ধরা পড়লে কেনা ও বিড করা সঙ্গে সঙ্গে পর্যালোচনা পর্যন্ত স্থগিত হয় এবং কালো তালিকাও হতে পারে। বিরোধে হারলে বিক্রেতা একটি স্ট্রাইক পান।',
        'আমাদের সিদ্ধান্ত ঠিক করে জমা টাকা কে পাবেন। এটি আইনে আপনার অধিকার কেড়ে নেয় না।',
      ],
    },
    {
      title: 'গেম অ্যাকাউন্ট',
      clauses: [
        'গেমের প্রকাশক অ্যাকাউন্ট হস্তান্তর নিষেধ করতে পারে এবং অ্যাকাউন্ট স্থগিত বা বন্ধ করে দিতে পারে। TrustBazaar-এর সুরক্ষা হস্তান্তর, নেওয়া এবং সুরক্ষা সময়ে বিক্রেতার অ্যাকাউন্ট ফিরে পাওয়াকে ধরে, প্রকাশকের কোনো পদক্ষেপকে নয়। টাকা দেওয়ার আগে ক্রেতাকে এটি বুঝেছেন বলে নিশ্চিত করতে হয়।',
        'বিক্রেতার লগ-ইনের তথ্য চাওয়া হয় কেবল টাকা জমা হওয়ার পর, অর্ডারে দেখানো সময়ের মধ্যে; না দিলে অর্ডার বাতিল হয় এবং ক্রেতা পুরো টাকা ফেরত পান। অ্যাকাউন্ট নেওয়ার পর সুরক্ষা সময়ে টাকা জমা থাকে এবং সময় শেষে, বা ক্রেতা চাইলে আগেই, ছাড়া হয়, যদি না কোনো বিরোধ খোলা থাকে।',
        'অ্যাকাউন্ট বিক্রির পর যে বিক্রেতা তা ফেরত নেন, রিসেট করেন, ব্যবহার করেন বা আবার বিক্রি করেন তিনি গুরুতর লঙ্ঘন করেন। কর্মীরা নিশ্চিত করলে বিক্রেতাকে স্থগিত করা হয়, তাঁর পরিচয়পত্র কালো তালিকায় যোগ হয় এবং অর্ডারের প্রমাণ পুলিশকে দেওয়া হতে পারে।',
      ],
    },
    {
      title: 'ফি ও কর',
      clauses: [
        'বিক্রেতা প্রতিটি বিক্রিতে পণ্যের দামের শতাংশ হিসেবে কমিশন দেন, যা কেবল বিক্রেতাকে ছাড়া দামের অংশে নেওয়া হয়। অর্ডার তৈরির সময়ের হার সেই অর্ডারে প্রযোজ্য। ডেলিভারি, ফিচার্ড লিস্টিং ও Pro Seller সাবস্ক্রিপশনের ফি বেছে নেওয়ার সময় দেখানো হয়।',
        'নিজের কর আপনার নিজের দায়িত্ব। TrustBazaar কর-পরামর্শ দেয় না।',
      ],
    },
    {
      title: 'আপনার আচরণ',
      clauses: [
        'আপনি করতে পারবেন না: কাউকে ঠকানো, হুমকি দেওয়া, হয়রানি বা গালিগালাজ; স্প্যাম পাঠানো; রেটিং বা বিড কারসাজি; ভুয়া বা অন্যের তথ্যে অ্যাকাউন্ট খোলা; পরিচয় যাচাই, সীমা বা স্থগিতাদেশ এড়ানো; অন্যের অ্যাকাউন্ট ব্যবহার; স্বয়ংক্রিয়ভাবে সাইট থেকে তথ্য সংগ্রহ; সেবা পরীক্ষা, আক্রমণ বা অতিরিক্ত চাপ দেওয়া; বা কাউকে এসব করতে উৎসাহ বা সাহায্য দেওয়া।',
        'এই শর্ত ভাঙছে এমন কোনো লিস্টিং, ব্যক্তি বা বার্তা দেখলে রিপোর্ট করুন। আমরা রিপোর্ট পর্যালোচনা করি।',
      ],
    },
    {
      title: 'সতর্কতা, সীমা ও বন্ধ করা',
      clauses: [
        'আপনি এই শর্ত বা নিয়ম ভাঙলে, ভঙ্গের গুরুত্ব অনুযায়ী আমরা লিস্টিং সরাতে, বিড বা অর্ডার বাতিল করতে, তদন্ত চলাকালে পেআউট আটকে রাখতে, আপনার অ্যাকাউন্টের কাজ সীমিত বা স্থগিত করতে, অ্যাকাউন্ট বন্ধ করতে এবং পরিচয়পত্র কালো তালিকায় তুলতে পারি। আমরা সাধারণত কারণ জানাব।',
        'চালু অর্ডার, বিরোধ ও বকেয়া মিটলে আপনি যেকোনো সময় অ্যাকাউন্ট বন্ধ করতে পারেন। বন্ধ করলে আপনার দেনা বাতিল হয় না, এবং আইন ও গোপনীয়তা নোটিশ যে রেকর্ড রাখার অনুমতি দেয় তা রাখার অধিকারও শেষ হয় না।',
      ],
    },
    {
      title: 'দায়',
      clauses: [
        'আইন যতটা অনুমতি দেয়, TrustBazaar দায়ী নয়: জিনিসের মান, নিরাপত্তা বা বৈধতার জন্য; বিক্রেতা, ক্রেতা, কুরিয়ার, পেমেন্ট সেবাদাতা বা গেম প্রকাশক যা করেন বা করেন না তার জন্য; আপনি সুরক্ষিত রাখেননি এমন অ্যাকাউন্টের কারণে ক্ষতির জন্য; আমরা ঠেকাতে পারিনি এমন সেবা বন্ধের জন্য; বা মুনাফা, সুযোগ বা অন্য পরোক্ষ ক্ষতির জন্য।',
        'আইন যতটা অনুমতি দেয়, একটি অর্ডারের জন্য আমাদের মোট দায় সেই অর্ডারে আমাদের কাছে জমা থাকা অঙ্ক পর্যন্ত সীমিত। আইন যে দায় সীমিত করতে দেয় না, যেমন প্রতারণার দায়, এই শর্ত তা সীমিত করে না।',
        'আপনার শর্ত ভঙ্গ, নিষিদ্ধ বা মিথ্যা লিস্টিং, বা বেআইনি কাজের কারণে আমাদের ক্ষতি, খরচ বা দাবি হলে আপনি তা আমাদের পরিশোধ করবেন।',
      ],
    },
    {
      title: 'পরীক্ষামূলক সংস্করণ',
      clauses: [
        'TrustBazaar-এর এই সংস্করণটি একটি বিশ্ববিদ্যালয় প্রকল্প। পেমেন্ট, কুরিয়ার ও পেমেন্ট সেবাদাতার বার্তা সিমুলেটেড, এবং কোনো আসল টাকা লেনদেন হয় না। এমন থাকা পর্যন্ত এখানকার কিছুই আসল পেমেন্টের দায় বা আসল জিনিস বা টাকার অধিকার তৈরি করে না। ওপরের নিয়মগুলো সেবা কীভাবে চলে তা বলে এবং লেখা অনুযায়ীই প্রয়োগ হয়।',
      ],
    },
    {
      title: 'সাধারণ',
      clauses: [
        'আমরা বিজ্ঞপ্তি পাঠাই আপনার অ্যাকাউন্টের ই-মেইল ও নম্বরে এবং TrustBazaar-এর ভেতরে আপনার অ্যাকাউন্টে; সেগুলো হালনাগাদ রাখতে হবে। সেখানে পাঠানো বিজ্ঞপ্তি পাওয়া হয়েছে বলে ধরা হয়।',
        'এই শর্ত বাংলাদেশের আইনে চলে, এবং এ নিয়ে বিরোধ ঢাকার আদালত নিষ্পত্তি করতে পারে; আইনে অন্য কোথাও যাওয়ার যে অধিকার আপনার আছে তা এতে কমে না।',
        'শর্তের কোনো অংশ বলবৎযোগ্য না হলে বাকিটা বহাল থাকে। কোনো শর্ত আমরা সঙ্গে সঙ্গে প্রয়োগ না করলেও পরে করতে পারি। এই শর্তে আপনার অধিকার আপনি অন্যকে হস্তান্তর করতে পারবেন না।',
        'এই শর্তাবলি বাংলা ও ইংরেজিতে প্রকাশিত। দুটির মধ্যে অমিল থাকলে ইংরেজি পাঠ প্রযোজ্য।',
      ],
    },
  ],
};

export const TERMS_TEXT: Record<'en' | 'bn', LegalText> = { en, bn };
