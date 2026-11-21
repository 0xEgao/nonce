import type { GetUserResponse } from '../types/api';
import { locationProblem } from '@nonce/shared';

export const isProfileComplete = (userData: GetUserResponse | undefined): boolean => {
  if (!userData) return false;

  // Check all required profile fields
  return !!(
    userData.email &&
    userData.name &&
    userData.description &&
    userData.background &&
    userData.githubProfileUrl &&
    userData.skills && userData.skills.length > 0 &&
    userData.firstHeardAboutBitcoinOn &&
    userData.bitcoinBooksRead && userData.bitcoinBooksRead.length > 0 &&
    userData.whyBitcoin &&
    userData.weeklyCohortCommitmentHours &&
    // A known country, and for India a state and city (#45); the profile form
    // shows which part is missing, so the join gate's redirect lands on a
    // fixable field. An old free-text `location` alone doesn't count.
    locationProblem({
      country: userData.country,
      state: userData.state,
      city: userData.city,
    }) === null
  );
};
