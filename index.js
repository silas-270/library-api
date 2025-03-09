import express from "express";
import cors from "cors";
import pgPromise from "pg-promise";

// PostgreSQL-Datenbankverbindung
const DATABASE_URL = "postgres://postgres:iTEBuyzYjJaLVxvKFvfJBTMaNdORmTBE@centerbeam.proxy.rlwy.net:58768/railway";
const pgp = pgPromise();
const db = pgp(DATABASE_URL);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Alle Buecher abrufen
app.get("/books", async (req, res) => {
  try {
    const books = await db.any("SELECT * FROM books");
    res.json(books);
  } catch (error) {
    console.error("Fehler beim Abrufen der Bücher:", error);
    res.status(500).json({ error: "Datenbankfehler" });
  }
});

// Neues Buch hinzufuegen
app.post("/books", async (req, res) => {
  try {
    const { title, author, genres, date, pages, location, is_borrowed, borrower_name, borrow_date, borrow_log } = req.body;
    
    console.log("Eingehende Daten:", req.body);

    await db.none(
      "INSERT INTO books (title, author, genres, date, pages, location, is_borrowed, borrower_name, borrow_date, borrow_log) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", 
      [title, author, genres, date, pages, location, is_borrowed, borrower_name, borrow_date, borrow_log]
    );

    res.status(201).json({ message: "Buch erfolgreich hinzugefügt!" });
  } catch (error) {
    console.error("Fehler beim Hinzufügen eines Buches:", error);
    res.status(500).json({ error: "Fehler beim Speichern in die Datenbank." });
  }
});

// POST /getFilteredBooks – Liefert gefilterte Bücher
app.post("/getFilteredBooks", async (req, res) => {
  try {
    const {
      id, title, author, genres, date, pages, location,
      showBorrowedBooks, showAllIDs, sortLabel, order,
      limit, page
    } = req.body;
    
    // Standardwerte und Sanitizing:
    const allowedSortColumns = ["id", "title", "author", "date", "pages", "location"];
    const sortColumn = (typeof sortLabel === "string" && allowedSortColumns.includes(sortLabel.toLowerCase()))
                         ? sortLabel.toLowerCase()
                         : "id";
    const sortOrder = (order && order.toUpperCase() === "DESC") ? "DESC" : "ASC";
    const lim = parseInt(limit) || 10;
    const off = (parseInt(page) || 0) * lim;
    
    let conditions = [];
    let values = [];
    let paramIndex = 1;
    
    if (id !== undefined && id != -1) {
      conditions.push(`CAST(COALESCE(books.id, id_list.generated_id) AS TEXT) LIKE $${paramIndex}`);
      values.push(id + "%");
      paramIndex++;
    }
    if (title && title !== "") {
      conditions.push(`books.title ILIKE $${paramIndex}`);
      values.push(title + "%");
      paramIndex++;
    }
    if (author && author !== "") {
      conditions.push(`books.author ILIKE $${paramIndex}`);
      values.push(author + "%");
      paramIndex++;
    }
    if (genres && Array.isArray(genres) && genres.length > 0) {
      const genreConds = genres.map(g => {
        values.push("%" + g + "%");
        return `books.genres ILIKE $${paramIndex++}`;
      });
      conditions.push("(" + genreConds.join(" OR ") + ")");
    }
    if (date !== undefined && date != -1) {
      conditions.push(`CAST(books.date AS TEXT) LIKE $${paramIndex}`);
      values.push(date + "%");
      paramIndex++;
    }
    if (pages !== undefined && pages != -1) {
      conditions.push(`CAST(books.pages AS TEXT) LIKE $${paramIndex}`);
      values.push(pages + "%");
      paramIndex++;
    }
    if (location && location !== "") {
      conditions.push(`TRIM(books.location) ILIKE $${paramIndex}`);
      values.push("%" + location.trim() + "%");
      paramIndex++;
    }
    if (showBorrowedBooks === true) {
      conditions.push("books.is_borrowed = true");
    }
    
    let query = "";
    if (showAllIDs === true) {
      // Hier wird sichergestellt, dass auch gelöschte IDs angezeigt werden.
      query += `
        WITH RECURSIVE id_list(generated_id) AS (
          SELECT 1
          UNION ALL
          SELECT generated_id + 1 FROM id_list WHERE generated_id < (SELECT COALESCE(MAX(id), 0) FROM books)
        )
        SELECT id_list.generated_id AS id, 
              COALESCE(books.title, '') AS title,
              COALESCE(books.author, '') AS author,
              COALESCE(books.genres, '') AS genres,
              COALESCE(books.date, 0) AS date,
              COALESCE(books.pages, 0) AS pages,
              COALESCE(books.location, '') AS location,
              COALESCE(books.is_borrowed, false) AS is_borrowed,
              books.borrower_name,
              books.borrow_date,
              books.borrow_log
        FROM id_list
        LEFT JOIN books ON id_list.generated_id = books.id
      `;
      
      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }
    } else {
      query = "SELECT * FROM books";
      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }
    }
    
    // Sortierung:
    if (["id", "date", "pages"].includes(sortColumn)) {
      query += ` ORDER BY CAST(${sortColumn} AS INTEGER) ${sortOrder}`;
    } else {
      query += ` ORDER BY ${sortColumn} ${sortOrder}`;
    }
    
    // Pagination
    query += " LIMIT " + lim + " OFFSET " + off;
    
    console.log("SQL Query:", query);
    console.log("Values:", values);
    
    const result = await db.any(query, values);
    res.json(result);
  } catch (error) {
    console.error("Error executing filtered query: ", error);
    res.status(500).json({ error: "Error executing filtered query", details: error.message });
  }
});

// POST /getBookCount – Liefert die Gesamtanzahl der Bücher gemäß Filter.
app.post("/getBookCount", async (req, res) => {
  try {
    const {
      id, title, author, genres, date, pages, location,
      showBorrowedBooks, showAllIDs
    } = req.body;
    
    let conditions = [];
    let values = [];
    let paramIndex = 1;
    
    if (id !== undefined && id != -1) {
      conditions.push(`CAST(COALESCE(books.id, id_list.generated_id) AS TEXT) LIKE $${paramIndex}`);
      values.push(id + "%");
      paramIndex++;
    }
    if (title && title !== "") {
      conditions.push(`books.title ILIKE $${paramIndex}`);
      values.push(title + "%");
      paramIndex++;
    }
    if (author && author !== "") {
      conditions.push(`books.author ILIKE $${paramIndex}`);
      values.push(author + "%");
      paramIndex++;
    }
    if (genres && Array.isArray(genres) && genres.length > 0) {
      const genreConds = genres.map(g => {
        values.push("%" + g + "%");
        return `books.genres ILIKE $${paramIndex++}`;
      });
      conditions.push("(" + genreConds.join(" OR ") + ")");
    }
    if (date !== undefined && date != -1) {
      conditions.push(`CAST(books.date AS TEXT) LIKE $${paramIndex}`);
      values.push(date + "%");
      paramIndex++;
    }
    if (pages !== undefined && pages != -1) {
      conditions.push(`CAST(books.pages AS TEXT) LIKE $${paramIndex}`);
      values.push(pages + "%");
      paramIndex++;
    }
    if (location && location !== "") {
      conditions.push(`TRIM(books.location) ILIKE $${paramIndex}`);
      values.push("%" + location.trim() + "%");
      paramIndex++;
    }
    if (showBorrowedBooks === true) {
      conditions.push("books.is_borrowed = true");
    }
    
    let query = "";
    if (showAllIDs === true) {
      query += `
        WITH RECURSIVE id_list(generated_id) AS (
          SELECT 1
          UNION ALL
          SELECT generated_id + 1 FROM id_list WHERE generated_id < (SELECT COALESCE(MAX(id), 0) FROM books)
        )
        SELECT COUNT(*) AS c FROM id_list LEFT JOIN books ON id_list.generated_id = books.id
      `;
      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }
    } else {
      query = "SELECT COUNT(*) AS c FROM books";
      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }
    }
    
    console.log("Count Query:", query);
    console.log("Values:", values);
    
    const result = await db.one(query, values);
    res.json({ count: result.c });
  } catch (error) {
    console.error("Error executing count query: ", error);
    res.status(500).json({ error: "Error executing count query", details: error.message });
  }
});

// Update eines Buches (versucht, ein Buch mit der gegebenen ID zu aktualisieren)
app.post("/updateBook", async (req, res) => {
  try {
    const { id, title, author, genres, date, pages, location } = req.body;
    const result = await db.result(
      "UPDATE books SET title = $1, author = $2, genres = $3, date = $4, pages = $5, location = $6 WHERE id = $7",
      [title, author, genres, date, pages, location, id]
    );
    if (result.rowCount > 0) {
      res.json({ message: "Buch erfolgreich aktualisiert." });
    } else {
      res.json({ message: "Kein Buch mit dieser ID gefunden." });
    }
  } catch (error) {
    console.error("Error updating book:", error);
    res.status(500).json({ error: error.message });
  }
});

// Update eines Buches -> Insert eines neuen Buches (wenn Update keinen Datensatz gefunden hat)
app.post("/insertBook", async (req, res) => {
  try {
    const { id, title, author, genres, date, pages, location } = req.body;
    // Hier wird der Buchdatensatz eingefügt und die neuen Felder für die Ausleihe mit Standardwerten gesetzt.
    const result = await db.one(
      "INSERT INTO books (id, title, author, genres, date, pages, location, is_borrowed, borrower_name, borrow_date, borrow_log) VALUES ($1, $2, $3, $4, $5, $6, $7, false, NULL, NULL, NULL) RETURNING id",
      [id, title, author, genres, date, pages, location]
    );
    res.json({ message: "Buch erfolgreich neu eingefügt.", id: result.id });
  } catch (error) {
    console.error("Error inserting book:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /book/:id Liefert den Buchdatensatz mit der angegebenen ID
app.get("/book/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    // Verwende pg-promise: db.oneOrNone gibt entweder einen Datensatz oder null zurück
    const book = await db.oneOrNone("SELECT * FROM books WHERE id = $1", [id]);
    if (book) {
      res.json(book);
    } else {
      res.status(404).json({ error: "Buch nicht gefunden" });
    }
  } catch (error) {
    console.error("Error fetching book:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /updateBorrowBook aktualisiert die Ausleihdaten eines Buches
app.post("/updateBorrowBook", async (req, res) => {
  try {
    const { id, is_borrowed, borrower_name, borrow_date, borrow_log } = req.body;
    
    // Fuehre das Update mit Prepared Statement aus
    const result = await db.result(
      "UPDATE books SET is_borrowed = $1, borrower_name = $2, borrow_date = $3, borrow_log = $4 WHERE id = $5",
      [is_borrowed, borrower_name, borrow_date, borrow_log, id]
    );
    
    if (result.rowCount > 0) {
      res.json({ message: "Ausleihstatus erfolgreich aktualisiert." });
    } else {
      res.status(404).json({ message: "Fehler: Buch nicht gefunden." });
    }
  } catch (error) {
    console.error("Fehler beim Aktualisieren der Ausleihdaten:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /deleteBook  Loescht ein Buch anhand der uebergebenen ID
app.post("/deleteBook", async (req, res) => {
  try {
    const { id } = req.body;
    const result = await db.result("DELETE FROM books WHERE id = $1", [id]);
    if (result.rowCount > 0) {
      res.json({ message: "Buch erfolgreich geloescht." });
    } else {
      res.status(404).json({ message: "Kein Buch mit dieser ID gefunden." });
    }
  } catch (error) {
    console.error("Fehler beim Loeschen des Buchs:", error);
    res.status(500).json({ error: error.message });
  }
});


app.listen(PORT, () => {
  console.log(`Server runs on http://localhost:${PORT}`);
});
