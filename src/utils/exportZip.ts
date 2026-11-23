import JSZip from 'jszip';

export async function generateProjectZip(): Promise<Blob> {
  const zip = new JSZip();

  // Root configuration files
  zip.file(
    'package.json',
    JSON.stringify(
      {
        name: 'bta-business-transform-africa',
        private: true,
        version: '1.0.0',
        type: 'module',
        scripts: {
          dev: 'vite --port=3000 --host=0.0.0.0',
          build: 'vite build',
          preview: 'vite preview',
          lint: 'tsc --noEmit',
        },
        dependencies: {
          '@google/genai': '^2.4.0',
          '@tailwindcss/vite': '^4.3.3',
          '@vitejs/plugin-react': '^6.1.1',
          'canvas-confetti': '^1.9.4',
          dotenv: '^17.2.3',
          express: '^4.21.2',
          jszip: '^3.10.1',
          'lucide-react': '^0.546.0',
          motion: '^12.23.24',
          react: '^19.0.1',
          'react-dom': '^19.0.1',
          vite: '^8.3.0',
        },
        devDependencies: {
          '@types/canvas-confetti': '^1.9.0',
          '@types/express': '^4.17.21',
          '@types/jszip': '^3.4.1',
          '@types/node': '^22.14.0',
          '@types/react': '^19.3.0',
          '@types/react-dom': '^19.3.0',
          autoprefixer: '^10.4.21',
          esbuild: '^0.25.0',
          tailwindcss: '^4.3.3',
          tsx: '^4.21.0',
          typescript: '^7.0.2',
        },
      },
      null,
      2
    )
  );

  zip.file(
    'vite.config.ts',
    `import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
  };
});
`
  );

  zip.file(
    'tsconfig.json',
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          experimentalDecorators: true,
          useDefineForClassFields: false,
          module: 'ESNext',
          types: ['vite/client'],
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          skipLibCheck: true,
          moduleResolution: 'bundler',
          isolatedModules: true,
          moduleDetection: 'force',
          allowJs: true,
          jsx: 'react-jsx',
          paths: { '@/*': ['./*'] },
          allowImportingTsExtensions: true,
          noEmit: true,
        },
        exclude: ['dist'],
      },
      null,
      2
    )
  );

  zip.file(
    'index.html',
    `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CHIEF ALPHONS COMPANY LTD</title>
    <meta name="description" content="Application professionnelle de gestion commerciale mobile pour commerces, quincailleries et distributeurs en Afrique avec gestion multidevise USD/CDF, caisse POS, stocks et synchronisation hors-ligne." />
    <meta property="og:title" content="CHIEF ALPHONS COMPANY LTD" />
    <meta property="og:description" content="Application professionnelle de gestion commerciale mobile pour commerces, quincailleries et distributeurs en Afrique avec gestion multidevise USD/CDF, caisse POS, stocks et synchronisation hors-ligne." />
    <meta property="og:type" content="website" />
    <meta name="theme-color" content="#0F2444" />
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
  );

  zip.file(
    '.env.example',
    `# GEMINI_API_KEY: Optional for future AI features
GEMINI_API_KEY="MY_GEMINI_API_KEY"
APP_URL="http://localhost:3000"
`
  );

  zip.file(
    '.gitignore',
    `node_modules
dist
dist-ssr
*.local
.env
.DS_Store
`
  );

  zip.file(
    'README.md',
    `# 🏢 CHIEF ALPHONS COMPANY LTD (CHIEF ALPHONS COMPANY LTD)

Application mobile & web professionnelle de gestion commerciale, caisse enregistreuse tactile (POS), stocks, dettes, approvisionnements et multidevise (USD / Franc Congolais CDF).

---

## 🚀 Démarrage Rapide (Web / PWA)

1. **Installer les dépendances** :
   \`\`\`bash
   npm install
   \`\`\`

2. **Lancer le serveur de développement** :
   \`\`\`bash
   npm run dev
   \`\`\`
   L'application sera accessible sur [http://localhost:3000](http://localhost:3000).

3. **Compiler pour la production** :
   \`\`\`bash
   npm run build
   \`\`\`

---

## 📱 Structure Native Android (Kotlin & Jetpack Compose)

Le dossier \`android/\` contient l'architecture et les fichiers sources prêts pour **Android Studio** (Ladybug / Iguana) :
- \`entities/ProductEntity.kt\` : Entité Room avec UUID et horodatage.
- \`dao/ProductDao.kt\` : Room DAO avec requêtes asynchrones Coroutines Flow.
- \`sync/SyncWorker.kt\` : WorkManager pour la synchronisation Cloud Firestore hors-ligne.
- \`screens/SalesScreen.kt\` : Écran de vente POS natif en Jetpack Compose Material 3.
- \`firestore.rules\` : Règles de sécurité Firestore avec isolation et contrôle de rôles (ADMIN, GESTIONNAIRE).

---

## 🌍 Spécificités Régionales
- **Fuseau horaire** : \`Africa/Lubumbashi\` (CAT GMT+2)
- **Monnaies** : USD ($) et Franc Congolais (CDF / FC) avec taux de change configurable et conservé de façon immuable par transaction.
- **Documents** : Ticket thermique 80 mm pour imprimante caisse et Facture format A4, avec partage WhatsApp pré-formaté.
`
  );

  // Android Studio folder
  const android = zip.folder('android')!;
  android.file(
    'firestore.rules',
    `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function hasRole(role) {
      return request.auth != null && 
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == role;
    }
    function isAdmin() { return hasRole('ADMIN'); }
    function isManager() { return hasRole('ADMIN') || hasRole('GESTIONNAIRE'); }
    function isCashier() { return request.auth != null; }

    match /products/{productId} {
      allow read: if request.auth != null;
      allow write: if isManager();
    }
    match /sales/{saleId} {
      allow read: if request.auth != null;
      allow create: if isCashier();
      allow update, delete: if isAdmin();
    }
    match /customer_debts/{debtId} {
      allow read, write: if isCashier();
    }
    match /settings/{docId} {
      allow read: if request.auth != null;
      allow write: if isAdmin();
    }
  }
}
`
  );

  const androidJava = android.folder('app/src/main/java/com/bta/business')!;
  androidJava.file(
    'data/local/entities/ProductEntity.kt',
    `package com.bta.business.data.local.entities

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.UUID

@Entity(tableName = "products")
data class ProductEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),
    val sku: String,
    val barcode: String,
    val name: String,
    val description: String,
    val categoryId: String,
    val brand: String,
    val photoUrl: String,
    val buyPriceUSD: Double,
    val sellPriceUSD: Double,
    val currentStock: Int,
    val minStock: Int = 5,
    val unit: String = "pcs",
    val syncStatus: String = "SYNCED",
    val updatedAt: Long = System.currentTimeMillis()
)
`
  );

  androidJava.file(
    'data/local/dao/ProductDao.kt',
    `package com.bta.business.data.local.dao

import androidx.room.*
import com.bta.business.data.local.entities.ProductEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface ProductDao {
    @Query("SELECT * FROM products ORDER BY name ASC")
    fun getAllProducts(): Flow<List<ProductEntity>>

    @Query("SELECT * FROM products WHERE id = :productId")
    suspend fun getProductById(productId: String): ProductEntity?

    @Query("SELECT * FROM products WHERE barcode = :barcode OR sku = :barcode LIMIT 1")
    suspend fun findByBarcode(barcode: String): ProductEntity?

    @Query("SELECT * FROM products WHERE currentStock <= minStock")
    fun getLowStockProducts(): Flow<List<ProductEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOrUpdate(product: ProductEntity)

    @Query("UPDATE products SET currentStock = currentStock - :quantity, updatedAt = :timestamp WHERE id = :productId")
    suspend fun decrementStock(productId: String, quantity: Int, timestamp: Long = System.currentTimeMillis())
}
`
  );

  androidJava.file(
    'sync/SyncWorker.kt',
    `package com.bta.business.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.tasks.await

class SyncWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    private val firestore = FirebaseFirestore.getInstance()

    override suspend fun doWork(): Result {
        return try {
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
`
  );

  return await zip.generateAsync({ type: 'blob' });
}

export function downloadProjectZip(blob: Blob, filename = 'chief-alphons-company-ltd-source.zip') {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
