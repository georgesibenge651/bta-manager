with open("src/db/storage.ts", "r") as f:
    content = f.read()

marker = "  /** Erases business data (demo seed). Accounts and PINs are kept. */\n  public resetToDefaultSeed() {"
methods = """  // ==========================================
  // BTA CARGO TRACKING METHODS
  // ==========================================

  public getCargoPackages(): CargoPackage[] {
    return this.state.cargoPackages || [];
  }

  public getCargoPackageById(id: string): CargoPackage | undefined {
    return (this.state.cargoPackages || []).find((pkg) => pkg.id === id);
  }

  public getCargoPackageByPackingNumber(packingNumber: string): CargoPackage | undefined {
    const clean = packingNumber.trim().toUpperCase();
    return (this.state.cargoPackages || []).find((pkg) => pkg.packingNumber.trim().toUpperCase() === clean);
  }

  public async saveCargoPackage(pkgData: Partial<CargoPackage>): Promise<CargoPackage> {
    const existing = pkgData.id ? this.getCargoPackageById(pkgData.id) : undefined;
    const packingNumber = existing ? existing.packingNumber : generateReferenceNumber("PKG");
    const registrationDate = existing ? existing.registrationDate : new Date().toISOString();
    const currentStatus = pkgData.currentStatus || (existing ? existing.currentStatus : "REGISTERED");
    
    const initialCostUSD = Number(pkgData.initialCostUSD) || 0;
    const transportFeeUSD = Number(pkgData.transportFeeUSD) || 0;
    const customsFeeUSD = Number(pkgData.customsFeeUSD) || 0;
    const extraFeeUSD = Number(pkgData.extraFeeUSD) || 0;
    const totalAmountUSD = initialCostUSD + transportFeeUSD + customsFeeUSD + extraFeeUSD;

    const payments = existing ? existing.payments : (pkgData.payments || []);
    const amountPaidUSD = payments.reduce((sum, p) => sum + (p.amountUSD || 0), 0);
    const remainingBalanceUSD = Math.max(0, totalAmountUSD - amountPaidUSD);

    const newPkg: CargoPackage = {
      id: pkgData.id || generateUUID(),
      packingNumber,
      customerId: pkgData.customerId,
      customerName: pkgData.customerName || "Client Comptoir",
      customerPhone: pkgData.customerPhone || "",
      supplierName: pkgData.supplierName || "Fournisseur Chine",
      description: pkgData.description || "Colis divers",
      originCountry: pkgData.originCountry || "Chine",
      originCity: pkgData.originCity || "Guangzhou",
      destinationCountry: pkgData.destinationCountry || "République Démocratique du Congo",
      destinationCity: pkgData.destinationCity || "Bunia",
      transportMode: pkgData.transportMode || "AIR",
      carrierName: pkgData.carrierName || "BTA Express Cargo",
      registrationDate,
      expectedShippingDate: pkgData.expectedShippingDate,
      piecesCount: Number(pkgData.piecesCount) || 1,
      weightKg: Number(pkgData.weightKg) || 0.1,
      volumeCbm: Number(pkgData.volumeCbm) || 0.01,
      photos: pkgData.photos || [],
      documents: pkgData.documents || [],
      currentStatus,
      initialCostUSD,
      transportFeeUSD,
      customsFeeUSD,
      extraFeeUSD,
      totalAmountUSD,
      amountPaidUSD,
      remainingBalanceUSD,
      currency: pkgData.currency || "USD",
      exchangeRate: pkgData.exchangeRate || this.state.settings.exchangeRate,
      events: existing ? existing.events : [
        {
          id: generateUUID(),
          packageId: pkgData.id || "",
          status: "REGISTERED",
          country: pkgData.originCountry || "Chine",
          city: pkgData.originCity || "Guangzhou",
          location: "Entrepôt d’enregistrement",
          date: new Date().toISOString(),
          comment: "Colis enregistré et étiqueté",
          recordedBy: this.state.currentUser.id,
          recordedByName: this.state.currentUser.name,
        }
      ],
      payments,
      createdById: existing ? existing.createdById : this.state.currentUser.id,
      createdByName: existing ? existing.createdByName : this.state.currentUser.name,
      syncStatus: "PENDING",
    };

    if (existing) {
      this.state.cargoPackages = this.state.cargoPackages.map((p) => p.id === newPkg.id ? newPkg : p);
    } else {
      this.state.cargoPackages = [newPkg, ...this.state.cargoPackages];
    }

    this.queueOfflineOperation("CARGO_SAVE", newPkg);
    this.persist();
    return newPkg;
  }

  public async addCargoEvent(packageId: string, eventData: { status: CargoStatus; country: string; city: string; location?: string; date?: string; comment: string; photoUrl?: string; documentUrl?: string }): Promise<CargoPackage> {
    const pkg = this.getCargoPackageById(packageId);
    if (!pkg) throw new Error("Colis introuvable");

    const newEvent: CargoEvent = {
      id: generateUUID(),
      packageId,
      status: eventData.status,
      country: eventData.country,
      city: eventData.city,
      location: eventData.location,
      date: eventData.date || new Date().toISOString(),
      comment: eventData.comment,
      photoUrl: eventData.photoUrl,
      documentUrl: eventData.documentUrl,
      recordedBy: this.state.currentUser.id,
      recordedByName: this.state.currentUser.name,
    };

    pkg.events = [newEvent, ...pkg.events];
    pkg.currentStatus = eventData.status;
    pkg.syncStatus = "PENDING";

    this.state.cargoPackages = this.state.cargoPackages.map((p) => p.id === packageId ? pkg : p);
    this.queueOfflineOperation("CARGO_EVENT_ADD", { packageId, event: newEvent });
    this.persist();
    return pkg;
  }

  public async addCargoPayment(packageId: string, paymentData: { amountUSD: number; paymentMethod: PaymentMethod; notes?: string }): Promise<CargoPackage> {
    const pkg = this.getCargoPackageById(packageId);
    if (!pkg) throw new Error("Colis introuvable");

    const amountUSD = Number(paymentData.amountUSD) || 0;
    if (amountUSD <= 0) throw new Error("Montant invalide");

    const exchangeRate = this.state.settings.exchangeRate;
    const amountCDF = usdToCdf(amountUSD, exchangeRate);
    const receiptNumber = generateReferenceNumber("REC-CARGO");

    const newPayment: CargoPayment = {
      id: generateUUID(),
      packageId,
      amountUSD,
      amountCDF,
      exchangeRate,
      paymentMethod: paymentData.paymentMethod,
      receiptNumber,
      date: new Date().toISOString(),
      recordedBy: this.state.currentUser.id,
      notes: paymentData.notes,
    };

    pkg.payments = [newPayment, ...pkg.payments];
    pkg.amountPaidUSD = pkg.payments.reduce((sum, p) => sum + (p.amountUSD || 0), 0);
    pkg.remainingBalanceUSD = Math.max(0, pkg.totalAmountUSD - pkg.amountPaidUSD);
    pkg.syncStatus = "PENDING";

    this.state.cargoPackages = this.state.cargoPackages.map((p) => p.id === packageId ? pkg : p);
    this.queueOfflineOperation("CARGO_PAYMENT_ADD", { packageId, payment: newPayment });
    this.persist();
    return pkg;
  }

  /** Erases business data (demo seed). Accounts and PINs are kept. */
  public resetToDefaultSeed() {"

content = content.replace(marker, methods)
with open("src/db/storage.ts", "w") as f:
    f.write(content)
