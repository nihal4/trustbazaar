// A starter list of drop-off areas (docs/design/04_delivery.pdf section 5.2; CP-43; Decisions log, U4-02), loaded by
// `node dist/areas-seed.js`, not by a migration, because the design's SQL tests insert their own areas into the
// migrated database. Zones follow the rate cards' three zones: Dhaka city areas are inside Dhaka; Savar, Keraniganj,
// Ashulia, Gazipur, Tongi and Narayanganj are Dhaka suburbs; every other district is outside Dhaka (and a district
// with no listed area is outside Dhaka anyway, delivery.zone_at). Centroids are approximate, rounded to 3 decimals
// (about 110 m), and are a draft for an administrator to review and correct in the console (PATCH /admin/areas/{id}).
export interface StarterArea {
  district: string;
  nameEn: string;
  nameBn: string;
  zone: 'inside_dhaka' | 'dhaka_suburbs' | 'outside_dhaka';
  lat: number;
  lng: number;
}

const dhaka = (nameEn: string, nameBn: string, lat: number, lng: number): StarterArea => ({ district: 'Dhaka', nameEn, nameBn, zone: 'inside_dhaka', lat, lng });
const suburb = (district: string, nameEn: string, nameBn: string, lat: number, lng: number): StarterArea => ({ district, nameEn, nameBn, zone: 'dhaka_suburbs', lat, lng });
const town = (district: string, districtBn: string, lat: number, lng: number): StarterArea =>
  ({ district, nameEn: `${district} Sadar`, nameBn: `${districtBn} সদর`, zone: 'outside_dhaka', lat, lng });

export const STARTER_AREAS: StarterArea[] = [
  dhaka('Badda', 'বাড্ডা', 23.781, 90.426),
  dhaka('Banani', 'বনানী', 23.794, 90.405),
  dhaka('Bashundhara', 'বসুন্ধরা', 23.819, 90.432),
  dhaka('Dhanmondi', 'ধানমন্ডি', 23.746, 90.376),
  dhaka('Gulshan', 'গুলশান', 23.792, 90.416),
  dhaka('Jatrabari', 'যাত্রাবাড়ী', 23.710, 90.435),
  dhaka('Khilgaon', 'খিলগাঁও', 23.752, 90.426),
  dhaka('Lalbagh', 'লালবাগ', 23.719, 90.388),
  dhaka('Mirpur', 'মিরপুর', 23.807, 90.368),
  dhaka('Mohakhali', 'মহাখালী', 23.778, 90.405),
  dhaka('Mohammadpur', 'মোহাম্মদপুর', 23.766, 90.358),
  dhaka('Motijheel', 'মতিঝিল', 23.733, 90.418),
  dhaka('Rampura', 'রামপুরা', 23.762, 90.420),
  dhaka('Shyamoli', 'শ্যামলী', 23.771, 90.365),
  dhaka('Tejgaon', 'তেজগাঁও', 23.758, 90.390),
  dhaka('Uttara', 'উত্তরা', 23.876, 90.380),
  suburb('Dhaka', 'Ashulia', 'আশুলিয়া', 23.903, 90.304),
  suburb('Dhaka', 'Keraniganj', 'কেরানীগঞ্জ', 23.698, 90.346),
  suburb('Dhaka', 'Savar', 'সাভার', 23.858, 90.267),
  suburb('Gazipur', 'Gazipur Sadar', 'গাজীপুর সদর', 23.999, 90.420),
  suburb('Gazipur', 'Tongi', 'টঙ্গী', 23.892, 90.404),
  suburb('Narayanganj', 'Narayanganj Sadar', 'নারায়ণগঞ্জ সদর', 23.623, 90.500),
  suburb('Narayanganj', 'Siddhirganj', 'সিদ্ধিরগঞ্জ', 23.683, 90.513),
  town('Barishal', 'বরিশাল', 22.701, 90.353),
  town('Bogura', 'বগুড়া', 24.847, 89.377),
  town('Brahmanbaria', 'ব্রাহ্মণবাড়িয়া', 23.958, 91.111),
  town('Chattogram', 'চট্টগ্রাম', 22.335, 91.834),
  town("Cox's Bazar", 'কক্সবাজার', 21.427, 92.006),
  town('Cumilla', 'কুমিল্লা', 23.461, 91.185),
  town('Dinajpur', 'দিনাজপুর', 25.627, 88.637),
  town('Faridpur', 'ফরিদপুর', 23.607, 89.843),
  town('Feni', 'ফেনী', 23.011, 91.397),
  town('Jashore', 'যশোর', 23.167, 89.209),
  town('Khulna', 'খুলনা', 22.846, 89.540),
  town('Kushtia', 'কুষ্টিয়া', 23.901, 89.120),
  town('Manikganj', 'মানিকগঞ্জ', 23.864, 90.002),
  town('Munshiganj', 'মুন্সীগঞ্জ', 23.542, 90.530),
  town('Mymensingh', 'ময়মনসিংহ', 24.757, 90.407),
  town('Narsingdi', 'নরসিংদী', 23.932, 90.715),
  town('Noakhali', 'নোয়াখালী', 22.869, 91.099),
  town('Pabna', 'পাবনা', 24.006, 89.237),
  town('Rajshahi', 'রাজশাহী', 24.374, 88.601),
  town('Rangpur', 'রংপুর', 25.746, 89.251),
  town('Sylhet', 'সিলেট', 24.895, 91.869),
  town('Tangail', 'টাঙ্গাইল', 24.250, 89.917),
];
