import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import csv from "csv-parser";
import { fileURLToPath } from "url";
import xlsx from "xlsx";



dotenv.config();

const app = express();
const port = process.env.PORT;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const csvFilePath = path.join(__dirname, "public", "test.csv");

const studentToCoaches = {}; // 学员姓名：[教练名单]


// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());


function populateStudentToCoaches() {
  fs.createReadStream(csvFilePath)
  .pipe(csv()) // default delimiter is comma, so semicolons are inside quoted cells
  .on("data", (row) => {
    const student = row.Name;
    const coachesStr = row.Coaches || "";

    // Split on semicolon, trim whitespace, and remove empty strings
    const coachList = coachesStr
      .split(";")
      .map((c) => c.trim())
      .filter(Boolean);
    // If you only have one row per student, just set the array:
    studentToCoaches[student] = coachList;

  })
  .on("end", () => {
    console.log("CSV file successfully processed.");
    //console.log("Student-to-Coaches dictionary:", studentToCoaches);
  })
  .on("error", (err) => {
    console.error("Error reading CSV file:", err);
  });
}
populateStudentToCoaches();

// Your extractNames function
function extractNames(text) {

  const nameRegex = /\d+[\.\s]?([\p{Script=Han}]{2,})/gu;
  let matches = [...text.matchAll(nameRegex)];
  let filteredNames = matches
    .map(match => match[1])
    .filter(name => !name.startsWith("号"));
  console.log(filteredNames)
  return filteredNames;
}

// 1. Render index with an empty names array by default
app.get("/", (req, res) => {
  res.render("index.ejs", { matchedStudentsToCoaches: {} });
});

// 2. On form submission, extract names and re-render the page
app.post("/submit", (req, res) => {
  const userText = req.body.userText;
  const names = extractNames(userText);
  //console.log("Extracted names:", names);

  const matchedStudentsToCoaches = {};
  for (const name of names) {
    const coaches = studentToCoaches[name];
    if (coaches) {
      matchedStudentsToCoaches[name] = coaches;
    }
  }
  // Render the same EJS page, but pass in the names array
  res.render("index.ejs", { matchedStudentsToCoaches: matchedStudentsToCoaches });
});

app.post("/finish-selection", (req, res) => {
  const selectedCoaches = req.body.selectedCoaches;
  console.log("Selected Coaches Data:", selectedCoaches);

  // Convert { student: [coaches] } to { coach: [students] }
  const coachToStudents = {};

  Object.entries(selectedCoaches).forEach(([student, coaches]) => {
    coaches.forEach(coach => {
      if (!coachToStudents[coach]) {
        coachToStudents[coach] = [];
      }
      coachToStudents[coach].push(student);
    });
  });

  console.log("Transformed Data:", coachToStudents);

  // Generate Excel workbook
  const workbook = xlsx.utils.book_new();
  const sheetData = [["教练", "学员"]];

  Object.entries(coachToStudents).forEach(([coach, students]) => {
    sheetData.push([coach, students.join(", ")]);
  });

  const worksheet = xlsx.utils.aoa_to_sheet(sheetData);
  xlsx.utils.book_append_sheet(workbook, worksheet, "Coaches");

  // Write the Excel file to a buffer (in-memory)
  const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });

  // Set response headers for file download
  res.setHeader("Content-Disposition", 'attachment; filename="coaches.xlsx"');
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

  // Send the file
  res.send(buffer);
});

app.post("/add-student", (req, res) => {
  const { student, coach } = req.body;

  if (!student || !coach) {
    return res.status(400).json({ error: "学员和教练不能为空!" });
  }

  // Add student to dictionary
  if (!studentToCoaches[student]) {
    studentToCoaches[student] = [];
  }
  studentToCoaches[student].push(coach);

  console.log(`✅ 学员 ${student} 分配给教练 ${coach}`);
  res.json({ message: `学员 ${student} 成功添加!` });
});
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
