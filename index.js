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
const studentFilePath = path.join(__dirname, "public", "student.csv");
const coachFilePath = path.join(__dirname, 'public', 'coach.csv');




// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

function populateStudentToCoaches() {
  return new Promise((resolve, reject) => {
    const studentToCoaches = {}; // 学员姓名：[教练名单]
    fs.createReadStream(studentFilePath)
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
        //console.log("CSV file successfully processed.");
        resolve(studentToCoaches); // Resolve the Promise with the populated dictionary
      })
      .on("error", (err) => {
        console.error("Error reading CSV file:", err);
        reject(err); // Reject the Promise on error
      });
  });
}

// Your extractNames function
function extractNames(text) {

  const nameRegex = /\d+[\.\s]?([\p{Script=Han}]{2,})/gu;
  let matches = [...text.matchAll(nameRegex)];
  let filteredNames = matches
    .map(match => match[1])
    .filter(name => !name.startsWith("号"));
  //console.log(filteredNames)
  return filteredNames;
}

// 1. Render index with an empty names array by default
app.get("/", (req, res) => {
  res.render("index.ejs", { matchedStudentsToCoaches: {} });
});

// 2. On form submission, extract names and re-render the page
app.post("/submit", async (req, res) => {
  try {
    const userText = req.body.userText;
    const names = extractNames(userText);
    //console.log("Extracted names:", names);

    const studentToCoaches = await populateStudentToCoaches(); // Wait for the data to be populated
    //console.log("Student-to-Coaches Dictionary:", studentToCoaches);

    const matchedStudentsToCoaches = {};
    for (const name of names) {
      const coaches = studentToCoaches[name];
      if (coaches) {
        matchedStudentsToCoaches[name] = coaches;
      }
    }

    res.render("index.ejs", { matchedStudentsToCoaches: matchedStudentsToCoaches });
  } catch (error) {
    console.error("Error processing CSV:", error);
    res.status(500).send("Error processing CSV file");
  }
});

app.post("/finish-selection", (req, res) => {
  const selectedCoaches = req.body.selectedCoaches;
  //console.log("Selected Coaches Data:", selectedCoaches);

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

  //console.log("Transformed Data:", coachToStudents);

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


app.post('/add-student', (req, res) => {
  // Retrieve and trim student name from the form
  const studentName = req.body.studentName.trim();
  // Retrieve coach options; if only one is selected, make it an array
  let coachOptions = req.body.coachOptions;
  if (!Array.isArray(coachOptions)) {
    coachOptions = coachOptions ? [coachOptions] : [];
  }

  // Path to the CSV file in the public folder
  let studentExists = false;

  // Read and parse the CSV file
  fs.createReadStream(studentFilePath)
    .pipe(csv())
    .on('data', (row) => {
      // Check if the current row's "Name" column matches the studentName
      if (row.Name && row.Name.trim() === studentName) {
        studentExists = true;
      }
    })
    .on('end', () => {
      if (studentExists) {
        // If the student already exists, send back a response that shows an alert
        res.send("<script>alert('学员已存在'); window.location.href = '/';</script>");
      } else {
        // If the student is not in the CSV, append the new student record.
        // Assume the CSV header is: Name,CoachOptions.
        // Coach options are stored as a semicolon-separated string.
        const newLine = `\n${studentName},"${coachOptions.join(';')}"`;
        fs.appendFile(studentFilePath, newLine, (err) => {
          if (err) {
            console.error('Error appending student:', err);
            return res.send("<script>alert('添加学员失败'); window.location.href = '/';</script>");
          }
          res.send("<script>alert('成功添加学员'); window.location.href = '/';</script>");
        });
      }
    })
    .on('error', (err) => {
      console.error('Error reading CSV file:', err);
      res.send("<script>alert('Error reading CSV file'); window.location.href = '/';</script>");
    });
});

app.post('/update-student', (req, res) => {
  // Retrieve and trim student name from the form
  const studentName = req.body.studentName.trim();
  // Retrieve coach options; ensure it's always an array
  let coachOptions = req.body.coachOptions;
  if (!Array.isArray(coachOptions)) {
    coachOptions = coachOptions ? [coachOptions] : [];
  }

  // Path to the CSV file in the public folder
  let rows = [];
  let studentFound = false;

  // Read and parse the CSV file
  fs.createReadStream(studentFilePath)
    .pipe(csv())
    .on('data', (row) => {
      // If the student name matches, update the coach options
      if (row.Name && row.Name.trim() === studentName) {
        studentFound = true;
        row.Coaches = coachOptions.join(';');
      }
      rows.push(row);
    })
    .on('end', () => {
      if (!studentFound) {
        // If the student doesn't exist, alert and redirect back to home page
        res.send("<script>alert('学生不存在'); window.location.href = '/';</script>");
      } else {
        // Reconstruct the CSV content
        // Assuming the CSV header is "Name,CoachOptions"
        let csvContent = "Name,Coaches";
        rows.forEach(row => {
          csvContent += `\n${row.Name},"${row.Coaches}"`;
        });
        // Write the updated content back to the CSV file
        fs.writeFile(studentFilePath, csvContent, (err) => {
          if (err) {
            console.error('Error updating student:', err);
            res.send("<script>alert('更新学员失败'); window.location.href = '/';</script>");
          } else {
            res.send("<script>alert('学员更新成功'); window.location.href = '/';</script>");
          }
        });
      }
    })
    .on('error', (err) => {
      console.error('Error reading CSV file:', err);
      res.send("<script>alert('读取CSV文件时出错'); window.location.href = '/';</script>");
    });
});

app.post('/delete-student', (req, res) => {
  const studentName = req.body.studentName.trim();
  let rows = [];
  let studentFound = false;

  // Read and parse the CSV file
  fs.createReadStream(studentFilePath)
    .pipe(csv())
    .on('data', (row) => {
      // Check if this row matches the student name
      if (row.Name && row.Name.trim() === studentName) {
        studentFound = true;
      } else {
        rows.push(row);
      }
    })
    .on('end', () => {
      if (!studentFound) {
        // If the student doesn't exist, alert and redirect back to home page
        res.send("<script>alert('学生不存在'); window.location.href = '/';</script>");
      } else {
        // Reconstruct the CSV content with header "Name,Coaches"
        let csvContent = "Name,Coaches";
        rows.forEach(row => {
          csvContent += `\n${row.Name},"${row.Coaches || ''}"`;
        });
        // Write the updated content back to the CSV file
        fs.writeFile(studentFilePath, csvContent, (err) => {
          if (err) {
            console.error('Error deleting student:', err);
            res.send("<script>alert('删除学员失败'); window.location.href = '/';</script>");
          } else {
            res.send("<script>alert('学员删除成功'); window.location.href = '/';</script>");
          }
        });
      }
    })
    .on('error', (err) => {
      console.error('Error reading CSV file:', err);
      res.send("<script>alert('读取CSV文件时出错'); window.location.href = '/';</script>");
    });
});

app.get('/get-coaches', (req, res) => {

  fs.readFile(coachFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error("Error reading coach.csv:", err);
      return res.status(500).json({ error: "读取教练文件时出错" });
    }

    // Split the file into lines and remove empty lines
    const lines = data.split("\n").map(line => line.trim()).filter(Boolean);

    // Remove the header row if it exists
    const coaches = lines.slice(1); // Assuming first line is "Name" header

    res.json(coaches);
  });
});


// Endpoint to add a coach
app.post('/add-coach', (req, res) => {
  const coachName = req.body.coachName.trim();
  let coachExists = false;
  let rows = [];

  fs.createReadStream(coachFilePath)
    .pipe(csv())
    .on('data', (row) => {
      // Check if the coach already exists (ignoring leading/trailing spaces)
      if (row.Name && row.Name.trim() === coachName) {
        coachExists = true;
      }
      rows.push(row);
    })
    .on('end', () => {
      if (coachExists) {
        // If the coach exists, alert the user.
        res.send("<script>alert('教练已存在'); window.location.href = '/';</script>");
      } else {
        // Append new coach name to the CSV file.
        // Assumes the CSV already has a header row "Name"
        const newLine = `\n${coachName}`;
        fs.appendFile(coachFilePath, newLine, (err) => {
          if (err) {
            console.error('Error appending coach:', err);
            res.send("<script>alert('添加教练失败'); window.location.href = '/';</script>");
          } else {
            res.send("<script>alert('教练添加成功'); window.location.href = '/';</script>");
          }
        });
      }
    })
    .on('error', (err) => {
      console.error('Error reading CSV file:', err);
      res.send("<script>alert('读取CSV文件时出错'); window.location.href = '/';</script>");
    });
});

// Endpoint to delete a coach
app.post('/delete-coach', (req, res) => {
  const coachName = req.body.coachName.trim();
  let coachFound = false;
  let rows = [];

  fs.createReadStream(coachFilePath)
    .pipe(csv())
    .on('data', (row) => {
      // If the row matches the coach name, skip it.
      if (row.Name && row.Name.trim() === coachName) {
        coachFound = true;
      } else {
        rows.push(row);
      }
    })
    .on('end', () => {
      if (!coachFound) {
        // If the coach is not found, alert the user.
        res.send("<script>alert('教练不存在'); window.location.href = '/';</script>");
      } else {
        // Reconstruct the CSV content with the header and remaining rows.
        let csvContent = "Name";
        rows.forEach(row => {
          csvContent += `\n${row.Name}`;
        });
        fs.writeFile(coachFilePath, csvContent, (err) => {
          if (err) {
            console.error('Error deleting coach:', err);
            res.send("<script>alert('删除教练失败'); window.location.href = '/';</script>");
          } else {
            res.send("<script>alert('教练删除成功'); window.location.href = '/';</script>");
          }
        });
      }
    })
    .on('error', (err) => {
      console.error('Error reading CSV file:', err);
      res.send("<script>alert('读取CSV文件时出错'); window.location.href = '/';</script>");
    });
});

// Download coaches endpoint with updated header "姓名"
app.get('/download-coaches', (req, res) => {
  fs.readFile(coachFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error("Error reading coach.csv:", err);
      res.status(500).send("读取教练文件时出错");
      return;
    }
    // Split the CSV data into lines and filter out empty lines.
    const lines = data.split("\n").map(line => line.trim()).filter(Boolean);
    // Build sheetData with our custom header ["姓名"]
    const sheetData = [["姓名"]];
    // If CSV has a header, remove it and use the remaining rows.
    const rows = lines.length > 0 ? lines.slice(1) : lines;
    rows.forEach(line => {
      // Each row is assumed to be just the coach name.
      sheetData.push([line]);
    });

    // Create workbook and worksheet using our custom sheetData.
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet(sheetData);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Coaches');

    // Write the workbook to a buffer as an .xlsx file.
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Set response headers so that the file is downloaded as "教练名单.xlsx".
    res.setHeader("Content-Disposition", 'attachment; filename="coaches.xlsx"');
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    res.send(buffer);
  });
});

// Download students endpoint with updated headers ["姓名", "教练"]
app.get('/download-students', (req, res) => {
  fs.readFile(studentFilePath, 'utf8', (err, data) => {
    if (err) {
      console.error("Error reading test.csv:", err);
      res.status(500).send("读取学员文件时出错");
      return;
    }
    // Split the CSV data into lines.
    const lines = data.split("\n").map(line => line.trim()).filter(Boolean);
    // Build sheetData with our custom header row.
    const sheetData = [["姓名", "教练"]];
    // If the CSV has a header, skip it.
    const rows = lines.length > 0 ? lines.slice(1) : lines;
    rows.forEach(line => {
      // Assuming the CSV columns are separated by commas.
      const parts = line.split(",");
      const studentName = parts[0] ? parts[0].trim() : "";
      const coaches = parts[1] ? parts[1].trim() : "";
      sheetData.push([studentName, coaches]);
    });

    // Create workbook and worksheet.
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet(sheetData);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Students');

    // Write the workbook to a buffer as an .xlsx file.
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Set response headers to force the browser to download the file as "学员名单.xlsx"
    res.setHeader("Content-Disposition", 'attachment; filename="students.xlsx"');
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    res.send(buffer);
  });
});


app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
