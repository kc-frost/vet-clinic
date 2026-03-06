// authMiddleware.js
// Middleware functions used to protect backend routes.
// These functions check whether the user is authenticated
// and whether they have admin privileges before allowing
// access to certain API endpoints.

 //requireAuth
 //This middleware ensures that a user is logged in.
 //It checks if the session contains a userID.
 //If no session exists, the request is rejected.
 
export function requireAuth(req, res, next) {
    if (!req.session?.userID) {
      return res.status(401).json({ message: "not authenticated" });
    }
    next();
  }

 // requireAdmin
 // This middleware ensures the user is both authenticated
 // and has administrator privileges.
 
  export function requireAdmin(req, res, next) {
    if (!req.session?.userID) {
      return res.status(401).json({ message: "not authenticated" });
    }
  
    if (!req.session?.isAdmin) {
      return res.status(403).json({ message: "forbidden" });
    }
  
    next();
  }