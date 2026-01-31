// Import a helper function that generates standard CRUD routes for a database table
import { createCrudRouter } from "../lib/tableCrud.js";


// Create and export a CRUD router for the "inventory" table
// - routeName: defines the API route path (e.g., /api/inventory)
// - tableName: specifies which database table these routes interact with
export default createCrudRouter({ routeName: "inventory", tableName: "inventory" });




