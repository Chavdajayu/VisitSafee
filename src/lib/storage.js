import { 
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, 
  query, where, orderBy, onSnapshot, deleteDoc, limit 
} from "firebase/firestore";
import { db } from "./firebase";
import { signOut } from "firebase/auth";
import { auth } from "./firebase";

const getEmail = (username, residencyId) => {
  return `${username.toLowerCase().replace(/[^a-z0-9]/g, '')}.${residencyId}@visitsafe.local`;
};

class StorageService {
  
  // === RESIDENCY MANAGEMENT ===

  async getResidencies() {
    const q = query(collection(db, "residencies"), orderBy("name"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  async registerResidency(data) {
    const residencyRef = await addDoc(collection(db, "residencies"), {
      name: data.residencyName,
      adminUsername: data.adminUsername,
      adminPassword: data.adminPassword, 
      adminPhone: data.adminPhone || null,
      createdAt: new Date().toISOString(),
    });
    
    const residencyId = residencyRef.id;

    return {
      id: residencyId,
      name: data.residencyName,
      adminUsername: data.adminUsername,
      adminPhone: data.adminPhone,
      createdAt: new Date().toISOString()
    };
  }

  // === AUTH ===

  async login(credentials) {
    const { username, password, residencyId } = credentials;

    // 1. Check Residency (Admin)
    const residencyRef = doc(db, "residencies", residencyId);
    const residencySnap = await getDoc(residencyRef);

    if (!residencySnap.exists()) {
      throw new Error("Residency not found");
    }

    const residencyData = residencySnap.data();
    const residencyName = residencyData.name;

    // Check Admin Credentials
    if (username === residencyData.adminUsername) {
      if (residencyData.adminPassword !== password) {
        throw new Error("Invalid credentials");
      }

      const adminUser = {
        id: "admin", 
        username: residencyData.adminUsername,
        role: "admin",
        name: "Admin", 
        phone: residencyData.adminPhone || null,
        active: true,
        residencyId: residencyId,
        residencyName: residencyName
      };
      this.saveSession(adminUser);
      return adminUser;
    }

    // 2. Check Residents
    const residentRef = doc(db, "residencies", residencyId, "residents", username);
    const residentSnap = await getDoc(residentRef);

    if (residentSnap.exists()) {
       const userData = residentSnap.data(); 
       
       if (userData.password !== password) {
         throw new Error("Invalid credentials");
       }

       if (userData.active === false) {
         throw new Error("Account disabled");
       }

       let flatNumber = null;
       if (userData.flatId) {
          const flatRef = doc(db, "residencies", residencyId, "flats", userData.flatId);
          const flatSnap = await getDoc(flatRef);
          if (flatSnap.exists()) {
             flatNumber = flatSnap.data().number;
          }
       }

       const user = { id: residentSnap.id, ...userData, residencyId, residencyName, role: "resident", flatNumber };
       delete user.password;
       
       this.saveSession(user);
       return user;
    }

    // 3. Check Guards
    const guardRef = doc(db, "residencies", residencyId, "guards", username);
    const guardSnap = await getDoc(guardRef);

    if (guardSnap.exists()) {
       const userData = guardSnap.data();

       if (userData.password !== password) {
         throw new Error("Invalid credentials");
       }

       if (userData.active === false) {
         throw new Error("Account disabled");
       }
       const user = { id: guardSnap.id, ...userData, residencyId, residencyName, role: "guard" };
       delete user.password;

       this.saveSession(user);
       return user;
    }

    throw new Error("Invalid credentials or user not found");
  }

  saveSession(user) {
    localStorage.setItem("society_user_session", JSON.stringify({
      username: user.username,
      residencyId: user.residencyId,
      residencyName: user.residencyName,
      role: user.role,
      flatNumber: user.flatNumber,
      loggedIn: true
    }));
    if (user.residencyName) {
      localStorage.setItem("residencyName", user.residencyName);
    }

    // Request persistent storage to prevent browser eviction
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then(granted => {
        if (granted) {
          console.log("Storage will not be cleared except by explicit user action");
        } else {
          console.log("Storage may be cleared by the UA under storage pressure.");
        }
      }).catch(err => console.error("Persistence check failed", err));
    }
  }

  async logout() {
    // Only clear session on explicit logout
    localStorage.removeItem("society_user_session");
    localStorage.removeItem("residencyName");
    try {
      await signOut(auth);
    } catch (error) {
      console.warn("Firebase signout error (harmless if already signed out):", error);
    }
  }

  async getCurrentUser() {
    const sessionStr = localStorage.getItem("society_user_session");
    if (!sessionStr) return null;

    try {
      const session = JSON.parse(sessionStr);
      if (!session.username || !session.residencyId) return null;

      // Verify user existence in background but return session immediately for speed
      // If user is deleted/disabled, it will fail on next action or we can add a swr revalidation
      
      const residencyRef = doc(db, "residencies", session.residencyId);
      // We check if we can get the doc, but we don't strictly block returning the session
      // to support offline/flaky internet usage ("remember me").
      // Ideally, we should do a background check.
      
      // For now, let's keep the verification but make it robust against network errors?
      // No, the user asked to "remember that person".
      // So we should trust localStorage first, then verify.
      
      // Let's do a quick verification but NOT logout automatically on network error.
      // Only logout if we are SURE the user is invalid (e.g., account deleted).
      
      try {
        const residencySnap = await getDoc(residencyRef);
        if (!residencySnap.exists()) {
           // Residency deleted - valid reason to logout
           await this.logout();
           return null;
        }

        const residencyData = residencySnap.data();
        
        if (session.role === 'admin') {
           if (residencyData.adminUsername !== session.username) {
             // Admin credentials changed - valid reason to logout
             await this.logout();
             return null;
           }
           // Update session with latest data if needed
           return {
              ...session,
              name: "Admin",
              phone: residencyData.adminPhone || null,
              active: true
           };
        }

        const collectionName = session.role === 'guard' ? 'guards' : 'residents';
        const userDoc = await getDoc(doc(db, "residencies", session.residencyId, collectionName, session.username));

        if (!userDoc.exists()) {
           // User deleted
           await this.logout();
           return null;
        }
        
        const userData = userDoc.data();
        if (userData.active === false) {
           // User banned/disabled
           await this.logout();
           return null;
        }
        
        let flatNumber = session.flatNumber;
        if (session.role === 'resident' && !flatNumber && userData.flatId) {
             const flatRef = doc(db, "residencies", session.residencyId, "flats", userData.flatId);
             const flatSnap = await getDoc(flatRef);
             if (flatSnap.exists()) {
                flatNumber = flatSnap.data().number;
             }
        }

        return { ...session, ...userData, id: userDoc.id, flatNumber };

      } catch (networkError) {
        console.warn("Network error verifying session, trusting localStorage:", networkError);
        // If offline, return the session from localStorage so the user stays logged in
        return session;
      }

    } catch (e) {
      console.error("Error parsing session:", e);
      return null;
    }
  }

  // === REAL-TIME HELPERS ===
  
  async getVisitorRequests(filter) {
    const dbUser = await this.getCurrentUser();
    if (!dbUser) return [];

    let q = query(
      collection(db, "residencies", dbUser.residencyId, "visitor_requests"), 
      orderBy("createdAt", "desc")
    );
    
    if (filter?.status) {
      q = query(q, where("status", "==", filter.status));
    }

    const snapshot = await getDocs(q);
    let requests = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    if (dbUser.role === "resident") {
        const residentDoc = await getDoc(doc(db, "residencies", dbUser.residencyId, "residents", dbUser.username));
        if (residentDoc.exists()) {
            const residentData = residentDoc.data();
            requests = requests.filter(r => r.flatId === residentData.flatId);
        }
    }

    const blocks = await this.getBlocks();
    const flatsSnapshot = await getDocs(collection(db, "residencies", dbUser.residencyId, "flats"));
    const flats = flatsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    return requests.map(req => {
        const flat = flats.find(f => f.id === req.flatId);
        if (!flat) return null;
        const block = blocks.find(b => b.id === flat.blockId);
        if (!block) return null;
        
        return {
        ...req,
        flat: { ...flat, block }
        };
    }).filter(Boolean);
  }

  async getAllVisitorRequestsWithDetails() {
    return this.getVisitorRequests();
  }

  async getStats() {
    const user = await this.getCurrentUser();
    if (!user) return { totalVisitors: 0, pendingRequests: 0, activeVisitors: 0 };

    const q = query(collection(db, "residencies", user.residencyId, "visitor_requests"));
    const snapshot = await getDocs(q);
    const requests = snapshot.docs.map(d => d.data());

    return {
      totalVisitors: requests.length,
      pendingRequests: requests.filter(r => r.status === 'pending').length,
      activeVisitors: requests.filter(r => r.status === 'entered').length
    };
  }

  async createPublicVisitorRequest(data, residencyId, residencyName) {
    if (!residencyId) throw new Error("Residency ID is required");
    
    const docData = {
      ...data,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const docRef = await addDoc(collection(db, "residencies", residencyId, "visitor_requests"), docData);
    
    // Trigger Push Notification
    try {
      if (data.flatId) {
        // Use provided residencyName or fallback to fetching (but here we try to be fast)
        // If residencyName is missing, deep link might default to root or need handling
        const societyPath = residencyName ? encodeURIComponent(residencyName) : 'society';
        
        fetch('/.netlify/functions/send-push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            residencyId,
            flatId: data.flatId,
            title: 'New Visitor Request',
            body: `${data.visitorName} wants to visit for ${data.purpose || 'a visit'}.`,
            data: {
              url: `/${societyPath}/resident`,
              requestId: docRef.id,
              residencyId: residencyId,
              username: 'system' 
            }
          })
        }).catch(err => console.warn("Background push trigger failed (expected in dev without netlify functions):", err));
      }
    } catch (e) {
      console.warn("Error triggering push notification:", e);
    }

    return docRef.id;
  }

  async createVisitorRequest(data) {
    const user = await this.getCurrentUser();
    if (!user) throw new Error("Not authenticated");
    
    return this.createPublicVisitorRequest(data, user.residencyId);
  }

  async updateVisitorRequestStatus(id, status) {
    const user = await this.getCurrentUser();
    if (!user) throw new Error("Not authenticated");

    const docRef = doc(db, "residencies", user.residencyId, "visitor_requests", id);
    await updateDoc(docRef, { 
      status,
      updatedAt: new Date().toISOString(),
      actionBy: user.username
    });
    return id;
  }

  subscribeToVisitorRequest(id, callback, residencyId) {
    let snapshotUnsubscribe = null;

    const setupSubscription = async () => {
        let targetResidencyId = residencyId;
        if (!targetResidencyId) {
             const user = await this.getCurrentUser();
             if (user) targetResidencyId = user.residencyId;
        }

        if (!targetResidencyId) {
            console.error("No residency ID provided for visitor subscription");
            callback(null);
            return;
        }

        const docRef = doc(db, "residencies", targetResidencyId, "visitor_requests", id);
        
        snapshotUnsubscribe = onSnapshot(docRef, async (docSnap) => {
            if (!docSnap.exists()) {
                callback(null);
                return;
            }

            const req = { id: docSnap.id, ...docSnap.data() };
            
            const flatsSnapshot = await getDocs(collection(db, "residencies", targetResidencyId, "flats"));
            const flats = flatsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            const blocks = await this.getBlocks(targetResidencyId);

            const flat = flats.find(f => f.id === req.flatId);
            let detailedReq = null;

            if (flat) {
                const block = blocks.find(b => b.id === flat.blockId);
                if (block) {
                    detailedReq = {
                        ...req,
                        flat: { ...flat, block }
                    };
                }
            }
            
            callback(detailedReq || req);
        });
    };

    setupSubscription();

    return () => {
        if (snapshotUnsubscribe) snapshotUnsubscribe();
    };
  }

  subscribeToVisitorRequests(callback, filter) {
    let snapshotUnsubscribe = null;

    this.getCurrentUser().then(async (dbUser) => {
      if (!dbUser) {
        callback([]);
        return;
      }

      let q = query(
        collection(db, "residencies", dbUser.residencyId, "visitor_requests"), 
        orderBy("createdAt", "desc")
      );
      
      if (filter?.status) {
        q = query(q, where("status", "==", filter.status));
      }

      snapshotUnsubscribe = onSnapshot(q, async (snapshot) => {
        let requests = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        if (dbUser.role === "resident") {
           const residentDoc = await getDoc(doc(db, "residencies", dbUser.residencyId, "residents", dbUser.username));
           if (residentDoc.exists()) {
             const residentData = residentDoc.data();
             requests = requests.filter(r => r.flatId === residentData.flatId);
           }
        }

        const blocks = await this.getBlocks();
        const flatsSnapshot = await getDocs(collection(db, "residencies", dbUser.residencyId, "flats"));
        const flats = flatsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        const detailedRequests = requests.map(req => {
          const flat = flats.find(f => f.id === req.flatId);
          if (!flat) return null;
          const block = blocks.find(b => b.id === flat.blockId);
          if (!block) return null;
          
          return {
            ...req,
            flat: { ...flat, block }
          };
        }).filter(Boolean);

        callback(detailedRequests);
      });
    });

    return () => {
      if (snapshotUnsubscribe) snapshotUnsubscribe();
    };
  }

  subscribeToUsers(callback) {
    let isSubscribed = true;
    let unsubRes;
    let unsubGuards;

    this.getCurrentUser().then(async (currentUser) => {
        if (!isSubscribed) return;
        if (!currentUser || currentUser.role !== 'admin') {
            callback([]);
            return;
        }

        const residentsQ = query(collection(db, "residencies", currentUser.residencyId, "residents"));
        const guardsQ = query(collection(db, "residencies", currentUser.residencyId, "guards"));
        
        let residents = [];
        let guards = [];
        
        const residencyDoc = await getDoc(doc(db, "residencies", currentUser.residencyId));
        let adminUser = null;
        if (residencyDoc.exists()) {
            const d = residencyDoc.data();
            adminUser = {
                id: "admin",
                username: d.adminUsername,
                role: "admin",
                name: "Admin",
                phone: d.adminPhone,
                active: true,
                residencyId: currentUser.residencyId
            };
        }

        const updateCallback = async () => {
             if (!isSubscribed) return;
             
             const allUsers = [...residents, ...guards];
             if (adminUser) allUsers.unshift(adminUser);

             const blocks = await this.getBlocks();
             const flatsSnapshot = await getDocs(collection(db, "residencies", currentUser.residencyId, "flats"));
             const flats = flatsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

             const detailedUsers = allUsers.map(user => {
                let flatDetails;
                
                if (user.role === "resident") {
                    const flat = flats.find(f => f.id === user.flatId);
                    if (flat) {
                        const block = blocks.find(b => b.id === flat.blockId);
                        if (block) flatDetails = { ...flat, block };
                    }
                }
                
                return { ...user, flat: flatDetails };
             });
             
             callback(detailedUsers);
        };

        unsubRes = onSnapshot(residentsQ, (resSnap) => {
             residents = resSnap.docs.map(d => ({ id: d.id, ...d.data(), role: 'resident' }));
             updateCallback();
        });

        unsubGuards = onSnapshot(guardsQ, (guardsSnap) => {
             guards = guardsSnap.docs.map(d => ({ id: d.id, ...d.data(), role: 'guard' }));
             updateCallback();
        });
    });

    return () => {
        isSubscribed = false;
        if (unsubRes) unsubRes();
        if (unsubGuards) unsubGuards();
    };
  }

  // === BLOCKS & FLATS ===

  async getResidencyByName(name) {
    const q = query(collection(db, "residencies"), where("name", "==", name));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  async getBlocks(residencyId) {
    let targetResidencyId = residencyId;
    if (!targetResidencyId) {
      const user = await this.getCurrentUser();
      if (!user) return [];
      targetResidencyId = user.residencyId;
    }
    
    const q = query(collection(db, "residencies", targetResidencyId, "blocks"), orderBy("name"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  async getFlatsByBlock(blockId, residencyId) {
    let targetResidencyId = residencyId;
    if (!targetResidencyId) {
      const user = await this.getCurrentUser();
      if (!user) return [];
      targetResidencyId = user.residencyId;
    }

    const q = query(collection(db, "residencies", targetResidencyId, "flats"), where("blockId", "==", blockId));
    const snapshot = await getDocs(q);
    const flats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return flats.sort((a, b) => a.number.localeCompare(b.number));
  }

  async createBlock(name) {
    const user = await this.getCurrentUser();
    if (!user) throw new Error("Not authenticated");

    const docRef = await addDoc(collection(db, "residencies", user.residencyId, "blocks"), { name });
    return { id: docRef.id, name };
  }

  async createFlat(number, blockId, floor) {
    const user = await this.getCurrentUser();
    if (!user) throw new Error("Not authenticated");

    const docRef = await addDoc(collection(db, "residencies", user.residencyId, "flats"), { number, blockId, floor });
    return { id: docRef.id, number, blockId, floor };
  }

  // === USERS (Admin Actions) ===

  async getAllUsersWithDetails() {
    const user = await this.getCurrentUser();
    if (!user || user.role !== 'admin') return [];

    const residentsSnapshot = await getDocs(collection(db, "residencies", user.residencyId, "residents"));
    const residents = residentsSnapshot.docs.map(d => ({ id: d.id, ...d.data(), role: 'resident' }));

    const guardsSnapshot = await getDocs(collection(db, "residencies", user.residencyId, "guards"));
    const guards = guardsSnapshot.docs.map(d => ({ id: d.id, ...d.data(), role: 'guard' }));

    const residencyDoc = await getDoc(doc(db, "residencies", user.residencyId));
    let adminUser = null;
    if (residencyDoc.exists()) {
        const d = residencyDoc.data();
        adminUser = {
            id: "admin",
            username: d.adminUsername,
            role: "admin",
            name: "Admin",
            phone: d.adminPhone,
            active: true,
            residencyId: user.residencyId
        };
    }

    const allUsers = [...residents, ...guards];
    if (adminUser) allUsers.unshift(adminUser);

    const blocks = await this.getBlocks();
    const flatsSnapshot = await getDocs(collection(db, "residencies", user.residencyId, "flats"));
    const flats = flatsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    return allUsers.map(u => {
      let flatDetails;
      
      if (u.role === "resident") {
        const flat = flats.find(f => f.id === u.flatId);
        if (flat) {
          const block = blocks.find(b => b.id === flat.blockId);
          if (block) {
            flatDetails = { ...flat, block };
          }
        }
      }
      
      return { ...u, flat: flatDetails };
    });
  }

  async createResident(data) {
    const user = await this.getCurrentUser();
    if (!user || user.role !== 'admin') throw new Error("Unauthorized");

    if (data.username === user.username) throw new Error("Cannot create user with same username as admin");

    const residentsRef = collection(db, "residencies", user.residencyId, "residents");
    const q = query(residentsRef, where("username", "==", data.username));
    const snap = await getDocs(q);
    if (!snap.empty) throw new Error("Username already taken");

    await setDoc(doc(residentsRef, data.username), {
      username: data.username,
      password: data.password, 
      phone: data.phone || null,
      flatId: data.flatId,
      active: true,
      createdAt: new Date().toISOString()
    });

    return { username: data.username };
  }

  async createSystemUser(data) {
    const user = await this.getCurrentUser();
    if (!user || user.role !== 'admin') throw new Error("Unauthorized");

    const collectionName = data.role === 'guard' ? 'guards' : 'residents';
    const usersRef = collection(db, "residencies", user.residencyId, collectionName);
    
    const q = query(usersRef, where("username", "==", data.username));
    const snap = await getDocs(q);
    if (!snap.empty) throw new Error("Username already taken");

    await setDoc(doc(usersRef, data.username), {
      username: data.username,
      password: data.password,
      phone: data.phone || null,
      active: true,
      createdAt: new Date().toISOString()
    });

    return { username: data.username };
  }

  async saveUserToken(token) {
    const user = await this.getCurrentUser();
    if (!user) return;

    try {
      if (user.role === 'admin') {
        const residencyRef = doc(db, "residencies", user.residencyId);
        await updateDoc(residencyRef, { adminFcmToken: token });
      } else {
        const collectionName = user.role === 'guard' ? 'guards' : 'residents';
        const userRef = doc(db, "residencies", user.residencyId, collectionName, user.username);
        await updateDoc(userRef, { fcmToken: token });
      }
      console.log('FCM Token saved for user:', user.username);
    } catch (error) {
      console.error("Error saving token:", error);
    }
  }

  async removeUserToken() {
    const user = await this.getCurrentUser();
    if (!user) return;

    try {
      if (user.role === 'admin') {
        const residencyRef = doc(db, "residencies", user.residencyId);
        await updateDoc(residencyRef, { adminFcmToken: null });
      } else {
        const collectionName = user.role === 'guard' ? 'guards' : 'residents';
        const userRef = doc(db, "residencies", user.residencyId, collectionName, user.username);
        await updateDoc(userRef, { fcmToken: null });
      }
    } catch (error) {
      console.error("Error removing token:", error);
    }
  }
}

export const storage = new StorageService();
