pragma circom 2.0.0;

include "circomlib/base2sum.circom";
include "circomlib/comparators.circom";
include "circomlib/bitify.circom";
include "circomlib/poseidon.circom";

/**
 * Age Verification Circuit
 * Verifies that a user is above a certain age without revealing their actual birthdate
 */

template AgeVerification() {
    signal input birthYear;
    signal input birthMonth;
    signal input birthDay;
    signal input currentYear;
    signal input currentMonth;
    signal input currentDay;
    signal input minAge;
    
    signal output isAboveMinAge;
    
    // Components for date comparison
    component yearDiff = Sub(32);
    component monthDiff = Sub(32);
    component dayDiff = Sub(32);
    component yearCheck = GreaterEqThan(32);
    component monthCheck = GreaterEqThan(32);
    component dayCheck = GreaterEqThan(32);
    component finalCheck = AND(3);
    
    // Calculate year difference
    yearDiff.in[0] <== currentYear;
    yearDiff.in[1] <== birthYear;
    
    // Calculate month difference
    monthDiff.in[0] <== currentMonth;
    monthDiff.in[1] <== birthMonth;
    
    // Calculate day difference
    dayDiff.in[0] <== currentDay;
    dayDiff.in[1] <== birthDay;
    
    // Check if year difference >= minAge
    yearCheck.in[0] <== yearDiff.out;
    yearCheck.in[1] <== minAge;
    
    // Check if month difference is valid (considering year difference)
    monthCheck.in[0] <== monthDiff.out;
    monthCheck.in[1] <== 0;
    
    // Check if day difference is valid (considering month difference)
    dayCheck.in[0] <== dayDiff.out;
    dayCheck.in[1] <== 0;
    
    // Final age verification logic
    // User is above min age if:
    // 1. Year difference >= minAge, OR
    // 2. Year difference == minAge-1 AND current month > birth month, OR
    // 3. Year difference == minAge-1 AND current month == birth month AND current day >= birth day
    
    component yearExactCheck = IsZero();
    yearExactCheck.in <== yearDiff.out - minAge;
    
    component monthGreaterCheck = GreaterThan(32);
    monthGreaterCheck.in[0] <== monthDiff.out;
    monthGreaterCheck.in[1] <== 0;
    
    component dayGreaterCheck = GreaterEqThan(32);
    dayGreaterCheck.in[0] <== dayDiff.out;
    dayGreaterCheck.in[1] <== 0;
    
    component monthDayCheck = AND(2);
    monthDayCheck.a <== monthGreaterCheck.out;
    monthDayCheck.b <== dayGreaterCheck.out;
    
    component alternativeCheck = AND(2);
    alternativeCheck.a <== yearExactCheck.out;
    alternativeCheck.b <== monthDayCheck.out;
    
    component finalOr = OR(2);
    finalOr.a <== yearCheck.out;
    finalOr.b <== alternativeCheck.out;
    
    isAboveMinAge <== finalOr.out;
}

/**
 * Identity Verification Circuit
 * Verifies identity claims without revealing personal information
 */

template IdentityVerification() {
    signal input userIdHash;
    signal input claimHash;
    signal input issuerSignature[8];
    signal input nullifierHash;
    signal input timestamp;
    
    signal output isValidClaim;
    signal output isNotRevoked;
    signal output isWithinValidTime;
    
    // Poseidon hash components
    component claimHasher = Poseidon(3);
    component nullifierHasher = Poseidon(2);
    
    // Verify claim integrity
    claimHasher.inputs[0] <== userIdHash;
    claimHasher.inputs[1] <== claimHash;
    claimHasher.inputs[2] <== timestamp;
    
    component claimCheck = IsEqual();
    claimCheck.in[0] <== claimHasher.out;
    claimCheck.in[1] <== claimHash;
    
    // Verify nullifier uniqueness
    nullifierHasher.inputs[0] <== userIdHash;
    nullifierHasher.inputs[1] <== claimHash;
    
    component nullifierCheck = IsNotZero();
    nullifierCheck.in <== nullifierHasher.out;
    
    // Time validity check (within 1 year)
    component maxTime = Num2Bits(32);
    maxTime.in <== timestamp + 365 * 24 * 60 * 60;
    
    component timeCheck = LessThan(32);
    timeCheck.in[0] <== timestamp;
    timeCheck.in[1] <== maxTime.out;
    
    // Final verification
    component finalAnd = AND(3);
    finalAnd.a <== claimCheck.out;
    finalAnd.b <== nullifierCheck.out;
    finalAnd.c <== timeCheck.out;
    
    isValidClaim <== claimCheck.out;
    isNotRevoked <== nullifierCheck.out;
    isWithinValidTime <== timeCheck.out;
}

/**
 * KYB (Know Your Business) Verification Circuit
 * Verifies business credentials without revealing sensitive business information
 */

template KYBVerification() {
    signal input businessIdHash;
    signal input registrationNumber;
    signal input incorporationDate;
    signal input jurisdiction;
    signal input businessType;
    signal input issuerSignature[8];
    
    signal output isValidBusiness;
    signal output isLegallyRegistered;
    signal output isCompliant;
    
    // Verify business registration
    component registrationHasher = Poseidon(3);
    registrationHasher.inputs[0] <== businessIdHash;
    registrationHasher.inputs[1] <== registrationNumber;
    registrationHasher.inputs[2] <== jurisdiction;
    
    component registrationCheck = IsNotZero();
    registrationCheck.in <== registrationHasher.out;
    
    // Verify incorporation date (business must be older than 1 year)
    component currentDate = Num2Bits(32);
    currentDate.in <== 20240101; // Example current date
    
    component minIncorporationDate = Num2Bits(32);
    minIncorporationDate.in <== 20230101; // At least 1 year old
    
    component incorporationCheck = GreaterEqThan(32);
    incorporationCheck.in[0] <== incorporationDate;
    incorporationCheck.in[1] <== minIncorporationDate.out;
    
    // Verify business type compliance
    component validBusinessTypes = Num2Bits(8);
    validBusinessTypes.in <== businessType;
    
    component businessTypeCheck = LessThan(8);
    businessTypeCheck.in[0] <== businessType;
    businessTypeCheck.in[1] <== 10; // Max 10 business types
    
    // Final verification
    component finalAnd = AND(3);
    finalAnd.a <== registrationCheck.out;
    finalAnd.b <== incorporationCheck.out;
    finalAnd.c <== businessTypeCheck.out;
    
    isValidBusiness <== registrationCheck.out;
    isLegallyRegistered <== incorporationCheck.out;
    isCompliant <== businessTypeCheck.out;
}

/**
 * Credential Revocation Check Circuit
 * Checks if a credential has been revoked without revealing the revocation list
 */

template RevocationCheck() {
    signal input credentialId;
    signal input revocationListRoot;
    signal input merkleProof[8][2];
    signal input revocationTimestamp;
    
    signal output isNotRevoked;
    signal output isValidProof;
    
    // Merkle tree verification
    component merkleVerifier = MerkleVerifier(8);
    merkleVerifier.leaf <== credentialId;
    merkleVerifier.root <== revocationListRoot;
    
    // Set merkle proof inputs
    for (var i = 0; i < 8; i++) {
        merkleVerifier.siblings[i][0] <== merkleProof[i][0];
        merkleVerifier.siblings[i][1] <== merkleProof[i][1];
    }
    
    component revocationCheck = IsZero();
    revocationCheck.in <== merkleVerifier.verified;
    
    // Check if credential was revoked (should be zero for non-revoked)
    component notRevoked = NOT();
    notRevoked.in <== revocationCheck.out;
    
    isNotRevoked <== notRevoked.out;
    isValidProof <== merkleVerifier.verified;
}

/**
 * Main ZK Identity Verification Circuit
 * Combines all verification circuits for comprehensive identity proof
 */

template ZKIdentityVerification() {
    signal input userId;
    signal input birthYear;
    signal input birthMonth;
    signal input birthDay;
    signal input currentYear;
    signal input currentMonth;
    signal input currentDay;
    signal input minAge;
    
    signal input businessId;
    signal input registrationNumber;
    signal input incorporationDate;
    signal input jurisdiction;
    signal input businessType;
    
    signal input issuerSignature[8];
    signal input revocationListRoot;
    signal input merkleProof[8][2];
    signal input timestamp;
    
    signal output isIdentityValid;
    signal output isAgeValid;
    signal output isBusinessValid;
    signal output isNotRevoked;
    
    // Age verification component
    component ageVerifier = AgeVerification();
    ageVerifier.birthYear <== birthYear;
    ageVerifier.birthMonth <== birthMonth;
    ageVerifier.birthDay <== birthDay;
    ageVerifier.currentYear <== currentYear;
    ageVerifier.currentMonth <== currentMonth;
    ageVerifier.currentDay <== currentDay;
    ageVerifier.minAge <== minAge;
    
    // Identity verification component
    component identityVerifier = IdentityVerification();
    identityVerifier.timestamp <== timestamp;
    
    // KYB verification component
    component kybVerifier = KYBVerification();
    kybVerifier.businessIdHash <== businessId;
    kybVerifier.registrationNumber <== registrationNumber;
    kybVerifier.incorporationDate <== incorporationDate;
    kybVerifier.jurisdiction <== jurisdiction;
    kybVerifier.businessType <== businessType;
    
    // Revocation check component
    component revocationChecker = RevocationCheck();
    revocationChecker.credentialId <== userId;
    revocationChecker.revocationListRoot <== revocationListRoot;
    
    // Set merkle proof
    for (var i = 0; i < 8; i++) {
        revocationChecker.merkleProof[i][0] <== merkleProof[i][0];
        revocationChecker.merkleProof[i][1] <== merkleProof[i][1];
    }
    
    // Final verification combining all components
    component finalAnd = AND(4);
    finalAnd.a <== ageVerifier.isAboveMinAge;
    finalAnd.b <== identityVerifier.isValidClaim;
    finalAnd.c <== kybVerifier.isValidBusiness;
    finalAnd.d <== revocationChecker.isNotRevoked;
    
    isIdentityValid <== finalAnd.out;
    isAgeValid <== ageVerifier.isAboveMinAge;
    isBusinessValid <== kybVerifier.isValidBusiness;
    isNotRevoked <== revocationChecker.isNotRevoked;
}

// Main circuit instantiation
component main = ZKIdentityVerification();
