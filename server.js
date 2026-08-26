require("dotenv").config();
const express = require("express");
const path = require("path");

const pagesRouter = require("./routes/pages");
const apiRouter = require("./routes/api");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use("/", pagesRouter);
app.use("/api", apiRouter);

app.use((req, res) => {
  res.status(404).render("404", {
    loja: { nome: "Casa Marisol", tagline: "Tudo para sua casa, com preço que cabe no bolso!" },
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Casa Marisol rodando em http://localhost:${PORT}`);
});
