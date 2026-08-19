import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
} from "amazon-cognito-identity-js";

const userPool = new CognitoUserPool({
  UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
  ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
});

/**
 * Signs in with email + password using Cognito's SRP flow. If the sign-in
 * succeeds outright, resolves { status: "signedIn", session }. If Cognito
 * challenges with TOTP (the adaptive-auth path Plus tier can trigger),
 * resolves { status: "mfaRequired", cognitoUser } instead - the caller
 * must then collect a 6-digit code from the user's authenticator app and
 * pass it to confirmMfaCode(cognitoUser, code) to finish signing in.
 * Rejects on outright failure (wrong password, etc).
 */
export function signIn(email, password) {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool });
    const authDetails = new AuthenticationDetails({
      Username: email,
      Password: password,
    });

    user.authenticateUser(authDetails, {
      onSuccess: (session) => resolve({ status: "signedIn", session }),
      onFailure: (err) => reject(err),
      totpRequired: () => resolve({ status: "mfaRequired", cognitoUser: user }),
      // SMS MFA isn't configured on this User Pool (see auth.ts:
      // mfaSecondFactor sms:false, otp:true) but the callback is included
      // for completeness in case that changes.
      mfaRequired: () => resolve({ status: "mfaRequired", cognitoUser: user }),
    });
  });
}

/**
 * Completes a sign-in that was interrupted by an MFA challenge. `code` is
 * the 6-digit TOTP code from the user's authenticator app.
 */
export function confirmMfaCode(cognitoUser, code) {
  return new Promise((resolve, reject) => {
    cognitoUser.sendMFACode(
      code,
      {
        onSuccess: (session) => resolve(session),
        onFailure: (err) => reject(err),
      },
      "SOFTWARE_TOKEN_MFA"
    );
  });
}

/**
 * First-time TOTP enrollment: generates the secret Cognito needs to
 * verify future codes, formatted as an otpauth:// URI a QR-code library
 * can render for the user to scan into their authenticator app. Call
 * this from a "set up MFA" settings flow, then verifyTotpSetup once
 * they've entered the code their app shows for that secret.
 */
export function beginTotpSetup(cognitoUser, accountEmail) {
  return new Promise((resolve, reject) => {
    cognitoUser.associateSoftwareToken({
      associateSecretCode: (secretCode) => {
        const issuer = "PaydayCompass";
        const otpauthUrl = `otpauth://totp/${issuer}:${encodeURIComponent(accountEmail)}?secret=${secretCode}&issuer=${issuer}`;
        resolve({ secretCode, otpauthUrl });
      },
      onFailure: (err) => reject(err),
    });
  });
}

export function verifyTotpSetup(cognitoUser, code) {
  return new Promise((resolve, reject) => {
    cognitoUser.verifySoftwareToken(code, "PaydayCompass", {
      onSuccess: (result) => resolve(result),
      onFailure: (err) => reject(err),
    });
  });
}

/**
 * Marks TOTP as this user's preferred/enabled MFA method. Must be called
 * after verifyTotpSetup succeeds - without this, Cognito has a verified
 * token but won't actually challenge future sign-ins with it.
 */
export function enableTotpMfaPreference(cognitoUser) {
  return new Promise((resolve, reject) => {
    cognitoUser.setUserMfaPreference(
      null, // no SMS MFA - this User Pool doesn't have it configured (see auth.ts)
      { PreferredMfa: true, Enabled: true },
      (err, result) => {
        if (err) reject(err);
        else resolve(result);
      }
    );
  });
}

/**
 * Returns the current CognitoUser with its session already hydrated -
 * required before associateSoftwareToken/verifySoftwareToken/
 * setUserMfaPreference will work; those calls silently fail without a
 * populated session. Rejects if nobody is signed in.
 */
export function getCurrentCognitoUser() {
  return new Promise((resolve, reject) => {
    const user = userPool.getCurrentUser();
    if (!user) {
      reject(new Error("Not signed in"));
      return;
    }
    user.getSession((err, session) => {
      if (err || !session || !session.isValid()) {
        reject(err || new Error("Session is not valid"));
        return;
      }
      resolve(user);
    });
  });
}

export function signOut() {
  const user = userPool.getCurrentUser();
  if (user) user.signOut();
}

/**
 * Returns a valid (auto-refreshed if needed) ID token for the currently
 * signed-in user, or null if nobody is signed in / the session is invalid.
 * The API Gateway Cognito authorizer expects this exact token - not the
 * access token - in the Authorization header (see lib/constructs/api.ts).
 */
export function getIdToken() {
  return new Promise((resolve) => {
    const user = userPool.getCurrentUser();
    if (!user) {
      resolve(null);
      return;
    }
    user.getSession((err, session) => {
      if (err || !session || !session.isValid()) {
        resolve(null);
        return;
      }
      resolve(session.getIdToken().getJwtToken());
    });
  });
}

export function getCurrentUserEmail() {
  const user = userPool.getCurrentUser();
  return user ? user.getUsername() : null;
}

/**
 * Creates a new Cognito user. Doesn't sign them in - Cognito requires
 * confirming the email with a code before the account can authenticate
 * (autoVerify: email is on for this pool, so that code is sent
 * automatically as part of this call). Password must satisfy the pool's
 * policy: 10+ characters, upper, lower, digit, and symbol - see
 * lib/constructs/auth.ts in the CDK repo.
 */
export function signUp(email, password) {
  return new Promise((resolve, reject) => {
    userPool.signUp(email, password, [{ Name: "email", Value: email }], null, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Confirms a new account with the code Cognito emailed after signUp.
 * Once this succeeds, the account can sign in normally.
 */
export function confirmSignUp(email, code) {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool });
    user.confirmRegistration(code, true, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Re-sends the confirmation code, for when the first one expired or
 * never arrived.
 */
export function resendConfirmationCode(email) {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool });
    user.resendConfirmationCode((err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Kicks off the "forgot password" flow - Cognito emails a verification
 * code to the account's address. Doesn't require being signed in, since
 * the whole point is recovering access when you can't sign in.
 */
export function forgotPassword(email) {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool });
    user.forgotPassword({
      onSuccess: (result) => resolve(result),
      onFailure: (err) => reject(err),
    });
  });
}

/**
 * Completes the forgot-password flow with the emailed code and a new
 * password. Succeeding here doesn't establish a session - the caller
 * still needs to sign in normally afterward with the new password.
 */
export function confirmForgotPassword(email, code, newPassword) {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: userPool });
    user.confirmPassword(code, newPassword, {
      onSuccess: () => resolve(),
      onFailure: (err) => reject(err),
    });
  });
}

/**
 * Returns every attribute on the current user as a plain object, e.g.
 * { email: "...", "custom:hasCompletedSetup": "true" }. Cognito custom
 * attributes are always returned prefixed with "custom:".
 */
export function getUserAttributes(cognitoUser) {
  return new Promise((resolve, reject) => {
    cognitoUser.getUserAttributes((err, attributes) => {
      if (err) {
        reject(err);
        return;
      }
      const map = {};
      (attributes || []).forEach((a) => {
        map[a.getName()] = a.getValue();
      });
      resolve(map);
    });
  });
}

/**
 * Marks the Getting Setup wizard as done (or explicitly skipped) for this
 * user, so they aren't sent there again on future sign-ins. Stored as the
 * string "true" - Cognito custom attributes are string/number only, no
 * real boolean type.
 */
export function markSetupComplete(cognitoUser) {
  return new Promise((resolve, reject) => {
    cognitoUser.updateAttributes([{ Name: "custom:hasCompletedSetup", Value: "true" }], (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Changes the signed-in user's password. Cognito requires the current
 * password even though the session is already authenticated - it's not
 * optional, this isn't a "forgot password" reset flow.
 */
export function changePassword(cognitoUser, oldPassword, newPassword) {
  return new Promise((resolve, reject) => {
    cognitoUser.changePassword(oldPassword, newPassword, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Starts an email change: updates the `email` attribute, which flips
 * `email_verified` to false and sends a confirmation code to the NEW
 * address automatically - the old address stays active and receiving
 * mail until confirmEmailChange succeeds. Resolves once the update is
 * submitted, not once it's confirmed.
 */
export function requestEmailChange(cognitoUser, newEmail) {
  return new Promise((resolve, reject) => {
    cognitoUser.updateAttributes([{ Name: "email", Value: newEmail }], (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Completes an email change with the code Cognito sent to the new
 * address. Until this succeeds, the account's email is still the OLD
 * address as far as sign-in is concerned.
 */
export function confirmEmailChange(cognitoUser, code) {
  return new Promise((resolve, reject) => {
    cognitoUser.verifyAttribute("email", code, {
      onSuccess: (result) => resolve(result),
      onFailure: (err) => reject(err),
    });
  });
}
