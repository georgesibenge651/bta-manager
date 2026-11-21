import fs from 'fs';

let content = fs.readFileSync('src/db/storage.ts', 'utf8');

// 1. Update type imports
content = content.replace(
  `  UserRole,\n} from '../types';`,
  `  UserRole,\n  CargoPackage,\n  CargoEvent,\n  CargoPayment,\n  CargoStatus,\n  TransportMode,\n} from '../types';`
);

// 2. Add cargoPackages to AppDatabaseState
content = content.replace(
  `  stockDamages: StockDamage[];\n  freeIssues: FreeIssue[];`,
  `  stockDamages: StockDamage[];\n  freeIssues: FreeIssue[];\n  cargoPackages: CargoPackage[];`
);

// 3. Add to optional array
content = content.replace(
  `const optional = ['reservations', 'reservationCancellations', 'reservationPayments', 'reservationDeliveries', 'stockDamages', 'freeIssues'] as const;`,
  `const optional = ['reservations', 'reservationCancellations', 'reservationPayments', 'reservationDeliveries', 'stockDamages', 'freeIssues', 'cargoPackages'] as const;`
);

// 4. Add cargoPackages: [] to cleanState
content = content.replace(
  `  stockDamages: [],\n  freeIssues: [],`,
  `  stockDamages: [],\n  freeIssues: [],\n  cargoPackages: [],`
);

// 5. Add to getDefaultState / other state initializers where [] lists are defined
content = content.replace(
  `stockDamages: [], freeIssues: [],`,
  `stockDamages: [], freeIssues: [], cargoPackages: [],`
);

content = content.replace(
  `stockDamages: [],\n      freeIssues: [],`,
  `stockDamages: [],\n      freeIssues: [],\n      cargoPackages: [],`
);

// 6. Add to businessKeys
content = content.replace(
  `'stockDamages','freeIssues'`,
  `'stockDamages','freeIssues','cargoPackages'`
);

fs.writeFileSync('src/db/storage.ts', content, 'utf8');
console.log('Successfully patched storage.ts state definitions.');
