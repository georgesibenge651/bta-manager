import React, { useState } from 'react';
import { Smartphone, Code, Copy, Check, X, Download, ShieldCheck, Database } from 'lucide-react';

interface KotlinSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDownloadZip?: () => void;
}

export const KotlinSourceModal: React.FC<KotlinSourceModalProps> = ({
  isOpen,
  onClose,
  onDownloadZip,
}) => {
  const [activeFile, setActiveFile] = useState<string>('ProductEntity');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const files: Record<string, { title: string; category: string; code: string }> = {
    ProductEntity: {
      title: 'ProductEntity.kt (Room)',
      category: 'Room Database & Entities',
      code: `package com.bta.business.data.local.entities

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
    val syncStatus: String = "SYNCED", // SYNCED, PENDING, ERROR
    val updatedAt: Long = System.currentTimeMillis()
)
`,
    },
    ProductDao: {
      title: 'ProductDao.kt (Room DAO)',
      category: 'Room Database & Entities',
      code: `package com.bta.business.data.local.dao

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
`,
    },
    SalesScreenCompose: {
      title: 'SalesScreen.kt (Jetpack Compose M3)',
      category: 'Jetpack Compose UI',
      code: `package com.bta.business.ui.screens.sales

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SalesScreen(
    viewModel: SalesViewModel = hiltViewModel(),
    onNavigateToReceipt: (String) -> Unit
) {
    val state by viewModel.uiState.collectAsState()
    val exchangeRate = state.settings.exchangeRate // e.g. 2800 CDF/USD

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Caisse Enregistreuse POS", color = Color.White) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color(0xFF0F2444)
                ),
                actions = {
                    Badge(containerColor = if (state.isOnline) Color(0xFF10B981) else Color(0xFFF59E0B)) {
                        Text(if (state.isOnline) "En Ligne" else "Hors-Ligne")
                    }
                }
            )
        },
        bottomBar = {
            CartCheckoutBottomBar(
                totalUSD = state.cartTotalUSD,
                totalCDF = state.cartTotalUSD * exchangeRate,
                onCheckoutClick = { viewModel.showPaymentDialog() }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            SearchBarWithBarcodeScanner(
                query = state.searchQuery,
                onQueryChange = { viewModel.onSearch(it) },
                onScanBarcode = { viewModel.openScanner() }
            )

            LazyColumn(
                modifier = Modifier.fillMaxWidth().weight(1f)
            ) {
                items(state.cartItems) { item ->
                    CartItemRow(
                        item = item,
                        exchangeRate = exchangeRate,
                        onIncrement = { viewModel.updateQuantity(item.productId, +1) },
                        onDecrement = { viewModel.updateQuantity(item.productId, -1) }
                    )
                }
            }
        }
    }
}
`,
    },
    SyncWorker: {
      title: 'SyncWorker.kt (WorkManager & Firestore)',
      category: 'WorkManager & Sync Engine',
      code: `package com.bta.business.sync

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
            // 1. Fetch pending offline sales from Room
            val pendingSales = getPendingSalesFromRoom()

            for (sale in pendingSales) {
                // 2. Atomic write to Firestore 'sales' collection
                firestore.collection("sales")
                    .document(sale.id)
                    .set(sale)
                    .await()

                // 3. Mark as SYNCED in local Room Database
                markSaleAsSynced(sale.id)
            }

            Result.success()
        } catch (e: Exception) {
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }

    private suspend fun getPendingSalesFromRoom(): List<Any> = emptyList()
    private suspend fun markSaleAsSynced(saleId: String) {}
}
`,
    },
    FirestoreRules: {
      title: 'firestore.rules (Sécurité & Isolation)',
      category: 'Firebase Firestore Rules',
      code: `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper function to check authenticated user role
    function hasRole(role) {
      return request.auth != null && 
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == role;
    }
    
    function isAdmin() {
      return hasRole('ADMIN');
    }

    function isManager() {
      return hasRole('ADMIN') || hasRole('GESTIONNAIRE');
    }

    function isCashier() {
      return request.auth != null;
    }

    // Products catalog
    match /products/{productId} {
      allow read: if request.auth != null;
      allow write: if isManager();
    }

    // Sales transactions (immutable once written, cannot overwrite retroactively)
    match /sales/{saleId} {
      allow read: if request.auth != null;
      allow create: if isCashier();
      allow update, delete: if isAdmin();
    }

    // Debts tracking
    match /customer_debts/{debtId} {
      allow read, write: if isCashier();
    }

    // Company Settings & Exchange Rate
    match /settings/{docId} {
      allow read: if request.auth != null;
      allow write: if isAdmin();
    }
  }
}
`,
    },
  };

  const currentFile = files[activeFile] || files.ProductEntity;

  const handleCopy = () => {
    navigator.clipboard.writeText(currentFile.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([currentFile.code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = currentFile.title.split(' ')[0];
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm overflow-y-auto">
      <div className="bg-slate-950 text-white rounded-3xl w-full max-w-4xl overflow-hidden shadow-2xl border border-slate-800 my-auto flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-[#0B1A30] p-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <Smartphone className="w-5 h-5 text-amber-400" />
            <div>
              <h3 className="font-bold text-sm sm:text-base text-white">
                Architecture Android Kotlin & Jetpack Compose
              </h3>
              <p className="text-xs text-amber-300">
                Code source natif conforme MVVM, Room DB, WorkManager & Firestore
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onDownloadZip && (
              <button
                onClick={onDownloadZip}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-sans font-bold flex items-center gap-1.5 shadow-sm transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Télécharger</span> Tout en ZIP
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-white/10 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* File selector pill list */}
        <div className="bg-slate-900 p-2 flex gap-1.5 border-b border-slate-800 overflow-x-auto shrink-0">
          {Object.entries(files).map(([key, f]) => (
            <button
              key={key}
              onClick={() => setActiveFile(key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition shrink-0 ${
                activeFile === key
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {f.title.split(' ')[0]}
            </button>
          ))}
        </div>

        {/* Code View Area */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 font-mono text-xs bg-slate-950 text-amber-300">
          <div className="flex items-center justify-between mb-3 text-slate-400">
            <span>{currentFile.category}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl flex items-center gap-1.5 text-xs font-sans transition"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copié !' : 'Copier'}
              </button>
              <button
                onClick={handleDownload}
                className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 text-white rounded-xl flex items-center gap-1.5 text-xs font-sans transition"
              >
                <Download className="w-3.5 h-3.5" />
                Télécharger .kt
              </button>
            </div>
          </div>

          <pre className="p-4 bg-slate-900 rounded-2xl overflow-x-auto border border-slate-800 text-slate-200 leading-relaxed">
            <code>{currentFile.code}</code>
          </pre>
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-900 border-t border-slate-800 flex justify-between items-center text-xs text-slate-400 shrink-0">
          <span>Prêt pour importation directe dans Android Studio Iguana / Ladybug</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-sans"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
