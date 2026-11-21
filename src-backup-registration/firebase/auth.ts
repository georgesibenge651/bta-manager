
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';

export interface FirebaseAccount {
  uid: string;
  email: string | null;
  displayName: string | null;
  isAnonymous: boolean;
}

type FirebaseUser = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  isAnonymous?: boolean;
} | null;

function normalizeUser(user: FirebaseUser): FirebaseAccount | null {
  if (!user) return null;

  return {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    isAnonymous: user.isAnonymous ?? false,
  };
}

function ensureNativePlatform() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error(
      'L’authentification Firebase est actuellement réservée à Android.'
    );
  }
}

export async function signInWithEmail(
  email: string,
  password: string
): Promise<FirebaseAccount> {
  ensureNativePlatform();

  const result = await FirebaseAuthentication.signInWithEmailAndPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  const account = normalizeUser(result.user);

  if (!account) {
    throw new Error('Firebase n’a retourné aucun utilisateur.');
  }

  return account;
}

export async function signInAnonymously(): Promise<FirebaseAccount> {
  ensureNativePlatform();
  const result = await FirebaseAuthentication.signInAnonymously();
  const account = normalizeUser(result.user);
  if (!account) {
    throw new Error('Firebase n’a retourné aucun utilisateur anonyme.');
  }
  return account;
}

export async function getFirebaseUser(): Promise<FirebaseAccount | null> {
  ensureNativePlatform();

  const result = await FirebaseAuthentication.getCurrentUser();
  return normalizeUser(result.user);
}

export async function signOutFirebase(): Promise<void> {
  ensureNativePlatform();
  await FirebaseAuthentication.signOut();
}

export async function listenToAuthChanges(
  callback: (account: FirebaseAccount | null) => void
) {
  ensureNativePlatform();

  return FirebaseAuthentication.addListener(
    'authStateChange',
    ({ user }) => callback(normalizeUser(user))
  );
}
