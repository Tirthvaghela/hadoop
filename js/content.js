/* ===== Study content: notes, viva, quiz, practice labs ===== */
(function (G) {
'use strict';
const J = G.JAVA;
const PATH = 'hdfs://localhost:9000/bda/employee_data.csv';
const Q = (g, q, m, code, out, note, extra) => Object.assign({ g, q, m, code, out, note }, extra || {});

/* ---------------- Unit 1 ---------------- */
const U1 = { id: 'u1', label: 'HDFS', sub: 'Unit 1', title: 'Unit 1 · Environment setup & HDFS commands',
  intro: 'Start the daemons, then practise every HDFS command. In HDFS there is no home folder by default, so always give full paths like /student.',
  setup: { m: 'bash', code: 'start-dfs.sh\nstart-yarn.sh\njps' },
  qs: [
    Q('START', 'Start Hadoop and check that all daemons are running.', 'bash', 'start-dfs.sh\nstart-yarn.sh\njps', 'jps lists <b>NameNode, DataNode, SecondaryNameNode, ResourceManager, NodeManager, Jps</b> (process ids differ).', 'start-dfs.sh starts the HDFS daemons, start-yarn.sh starts YARN. If NameNode is missing in jps, HDFS commands fail with "Connection refused".'),
    Q('START', 'Find the NameNode address (fs.defaultFS).', 'bash', 'hdfs getconf -confKey fs.defaultFS', '<code>hdfs://localhost:9000</code>', 'This is the address used in Spark paths: hdfs://localhost:9000/bda/...'),
    Q('BASIC', 'mkdir — create a directory /students in HDFS.', 'bash', 'hdfs dfs -mkdir /students\nhdfs dfs -mkdir -p /bda/hive', 'No output means success.', 'Without -p, the parent must already exist. With -p, missing parents are created and "File exists" is not an error.'),
    Q('BASIC', 'ls — list files; use -R for a recursive listing.', 'bash', 'hdfs dfs -ls /\nhdfs dfs -ls -R /', '<code>Found N items</code> then lines like <code>drwxr-xr-x   - hadoop supergroup 0 2026-10-13 23:10 /students</code>', 'lsr is the old (deprecated) form of ls -R.'),
    Q('BASIC', 'touchz — create an empty file /student/imscit.txt.', 'bash', 'hdfs dfs -mkdir -p /student\nhdfs dfs -touchz /student/imscit.txt\nhdfs dfs -ls /student', 'File size column shows <b>0</b>.', 'touchz fails if the folder does not exist, or if the file exists and is not empty.'),
    Q('FILES', 'put — create student.csv locally and upload it to /student.', 'bash', 'cat > student.csv << EOF\n1, Rahul, 80\n2, Rushabh, 90\n3, Atik, 70\nEOF\nhdfs dfs -put student.csv /student\nhdfs dfs -ls /student', 'Found 2 items: imscit.txt (0 bytes) and student.csv.', 'In the exam you can also type the file with  nano student.csv  (Ctrl+O to save, Ctrl+X to exit). put fails with "File exists" the second time; use -put -f to overwrite.'),
    Q('FILES', 'cat — display the contents of a file in HDFS.', 'bash', 'hdfs dfs -cat /student/student.csv', '1, Rahul, 80<br>2, Rushabh, 90<br>3, Atik, 70'),
    Q('FILES', 'head and tail — first / last part of a file.', 'bash', 'hdfs dfs -head /student/student.csv\nhdfs dfs -tail /student/student.csv', 'For a small file both print the whole file.', 'Linux head/tail = first/last 10 <b>lines</b>. HDFS -head/-tail = first/last 1 KB (1024 <b>bytes</b>).'),
    Q('FILES', 'get — download a file from HDFS to the Linux file system.', 'bash', 'hdfs dfs -get /student/student.csv ~/Documents/\nls ~/Documents', '<code>student.csv</code> now exists in ~/Documents.', '~ is the home folder. Without a destination, get saves into the current folder. It fails if the local file already exists.'),
    Q('FILES', 'cp — make a backup copy inside HDFS.', 'bash', 'hdfs dfs -cp /student/student.csv /student/student_backup.csv\nhdfs dfs -ls /student', '3 items: imscit.txt, student.csv, student_backup.csv.'),
    Q('FILES', 'mv — rename student.csv to data.csv.', 'bash', 'hdfs dfs -mv /student/student.csv /student/data.csv\nhdfs dfs -ls /student', 'student.csv is gone; data.csv appears.', 'mv is used both to move and to rename.'),
    Q('FILES', 'count — number of directories, files and total size.', 'bash', 'hdfs dfs -count /student', '<code>           1           3                 80 /student</code><br>(DIR_COUNT, FILE_COUNT, CONTENT_SIZE, PATH)', 'The directory itself is counted, so DIR_COUNT is 1.'),
    Q('FILES', 'du — size of each file.', 'bash', 'hdfs dfs -du /student\nhdfs dfs -du -s -h /student', 'One line per file: size, disk space consumed, path. -s gives one total, -h human-readable.'),
    Q('DELETE', 'rm — delete a file.', 'bash', 'hdfs dfs -rm /student/data.csv', '<code>Deleted /student/data.csv</code>'),
    Q('DELETE', 'rmdir — delete an empty directory.', 'bash', 'hdfs dfs -mkdir /imca\nhdfs dfs -rmdir /imca\nhdfs dfs -rmdir /student', 'First rmdir works. The second fails: <code>rmdir: `/student\': Directory is not empty</code>'),
    Q('DELETE', 'rm -r — delete a non-empty directory.', 'bash', 'hdfs dfs -rm -r /student', '<code>Deleted /student</code>', 'Use this to remove an old MapReduce output folder before running a job again.'),
  ] };

/* ---------------- Unit 2 ---------------- */
const javaRun = (p) => `mkdir -p ~/${p.prefix} && cd ~/${p.prefix}\nmkdir -p classes\njavac -classpath \`hadoop classpath\` -d classes *.java\njar -cvf ${p.prefix}.jar -C classes/ .\nhdfs dfs -mkdir -p /empinput\nhdfs dfs -put -f ~/employee_data.csv /empinput\nhdfs dfs -rm -r -f /out${p.n}\nhadoop jar ${p.prefix}.jar ${p.prefix}Driver /empinput /out${p.n}\nhdfs dfs -cat /out${p.n}/part-r-00000\ncd ~`;
const U2 = { id: 'u2', label: 'MapReduce', sub: 'Unit 2', title: 'Unit 2 · Hadoop MapReduce',
  intro: 'Built-in example jobs first, then custom Java jobs (Mapper + Reducer + Driver). Q4–18 use employee_data.csv (comma separated: ID, Name, Department, Salary, City, Product) uploaded to /empinput. The Run button saves the .java files into a folder for you and runs the steps.',
  setup: { m: 'bash', code: 'start-dfs.sh\nstart-yarn.sh\njps\nfind $HADOOP_HOME -name "hadoop-mapreduce-examples*.jar"' },
  qs: [
    Q('BUILT-IN', 'Practical 1 · WordCount: count each word in input.txt.', 'bash', 'cat > input.txt << EOF\nApple Orange Apple\nBanana Apple Orange\nMango Apple Banana\nEOF\nhdfs dfs -mkdir -p /input\nhdfs dfs -put -f input.txt /input\nhadoop jar $HADOOP_HOME/share/hadoop/mapreduce/hadoop-mapreduce-examples-*.jar wordcount /input /output\nhdfs dfs -ls /output\nhdfs dfs -cat /output/part-r-00000', '<b>Apple 4 · Banana 2 · Mango 1 · Orange 2</b> (tab separated). /output has <code>_SUCCESS</code> and <code>part-r-00000</code>.', 'Mapper emits (word, 1); shuffle & sort groups same words; reducer adds them. Running again fails with FileAlreadyExistsException — delete /output first: hdfs dfs -rm -r /output'),
    Q('BUILT-IN', 'Practical 2 · Grep: count how many times "Hadoop" appears.', 'bash', 'cat > grep.txt << EOF\nHadoop is Big Data Spark is Fast Hive works on Hadoop Hadoop is Open Source\nEOF\nhdfs dfs -mkdir -p /grepinput\nhdfs dfs -put -f grep.txt /grepinput\nhadoop jar $HADOOP_HOME/share/hadoop/mapreduce/hadoop-mapreduce-examples-*.jar grep /grepinput /grepoutput "Hadoop"\nhdfs dfs -cat /grepoutput/part-r-00000', '<code>3	Hadoop</code> (count first, then the match).', 'Argument order: grep &lt;input&gt; &lt;output&gt; &lt;regex&gt;. The pattern is case-sensitive.'),
    Q('BUILT-IN', 'Practical 3 · MultiFileWordCount: count words across two files.', 'bash', 'cat > file1.txt << EOF\nApple Mango Banana Apple\nEOF\ncat > file2.txt << EOF\nApple Orange Mango Orange\nEOF\nhdfs dfs -mkdir -p /multiinput\nhdfs dfs -put -f file1.txt file2.txt /multiinput\nhadoop jar $HADOOP_HOME/share/hadoop/mapreduce/hadoop-mapreduce-examples-*.jar multifilewc /multiinput /multioutput\nhdfs dfs -cat /multioutput/part-r-00000', '<b>Apple 3 · Banana 1 · Mango 2 · Orange 2</b>', 'Every file in the input folder is processed as one dataset.'),
    Q('CUSTOM', 'Practical 4 (class notes) · Filter employees with salary > 50000 from space-separated employee.txt.', 'bash', 'mkdir -p ~/EmployeeFilter && cd ~/EmployeeFilter\ncat > employee.txt << EOF\n101 Rahul HR 45000\n102 Neha IT 65000\n103 Amit HR 55000\n104 Priya Finance 70000\n105 Riya IT 48000\n106 Karan HR 60000\nEOF\nmkdir -p classes\njavac -classpath `hadoop classpath` -d classes *.java\nls classes\njar -cvf EmployeeFilter.jar -C classes/ .\nhdfs dfs -mkdir -p /filterinput\nhdfs dfs -put -f employee.txt /filterinput\nhdfs dfs -rm -r -f /filteroutput\nhadoop jar EmployeeFilter.jar EmployeeFilterDriver /filterinput /filteroutput\nhdfs dfs -cat /filteroutput/part-r-00000\ncd ~', '102 Neha IT 65000<br>103 Amit HR 55000<br>104 Priya Finance 70000<br>106 Karan HR 60000', 'split(" ") because this file is space separated, and data.length == 4. NullWritable as key so records are not grouped by anything.', { files: J.NOTES_FILTER, folder: 'EmployeeFilter' }),
    ...J.PROGRAMS.map(p => Q(p.n <= 6 ? 'FILTER' : p.n <= 9 ? 'SORT' : p.n <= 12 ? 'SUM' : p.n <= 15 ? 'AVERAGE' : 'OTHER', `Q${p.n} · ${p.title}`, 'bash', javaRun(p), p.expect.map(x => x.replace('\t', ' &nbsp;')).join('<br>'), p.idea, { files: p.files, folder: p.prefix, prog: p.n })),
  ] };

/* ---------------- Unit 3 ---------------- */
const U3 = { id: 'u3', label: 'Hive', sub: 'Unit 3', title: 'Unit 3 · HiveQL',
  intro: 'Run in order: later answers depend on earlier ones (Q24 uses the column renamed in Q6). Put employee_data.csv and department.csv in /bda/hive first. Turn on column headers with SET hive.cli.print.header=true;',
  setup: { m: 'bash', code: `cat > employee_data.csv << EOF\n${J.EMPLOYEE_CSV}EOF\ncat > department.csv << EOF\n${J.DEPARTMENT_CSV}EOF\nhdfs dfs -mkdir -p /bda/hive\nhdfs dfs -put -f employee_data.csv department.csv /bda/hive/\nhdfs dfs -ls /bda/hive` },
  qs: [
    Q('DDL', 'Create a database named company_db and select it.', 'hive', 'CREATE DATABASE IF NOT EXISTS company_db;\nUSE company_db;', 'Prints <b>OK</b>.'),
    Q('DDL', 'Create an employee table with ID, Name, Department, Salary, City, Product.', 'hive', "CREATE TABLE IF NOT EXISTS employee (\n  id INT, name STRING, department STRING,\n  salary INT, city STRING, product STRING\n)\nROW FORMAT DELIMITED\nFIELDS TERMINATED BY ','\nLINES TERMINATED BY '\\n'\nSTORED AS TEXTFILE;", 'OK', "FIELDS TERMINATED BY ',' must match the CSV delimiter, otherwise every column loads as NULL."),
    Q('DDL', 'Display all databases and tables in the current database.', 'hive', 'SHOW DATABASES;\nSHOW TABLES;', 'Databases: <b>company_db, default</b>. Tables: <b>employee</b>.'),
    Q('DDL', 'Display the structure of employee using DESCRIBE.', 'hive', 'DESCRIBE employee;\nDESCRIBE FORMATTED employee;', '6 rows: id int, name string, department string, salary int, city string, product string. FORMATTED adds the HDFS location, owner and delimiter.'),
    Q('DDL', 'Add an Email column using ALTER TABLE.', 'hive', 'ALTER TABLE employee ADD COLUMNS (email STRING);\nDESCRIBE employee;', 'email is added at the <b>end</b>; existing rows show NULL for it.'),
    Q('DDL', 'Rename the Product column to Purchased_Product.', 'hive', 'ALTER TABLE employee CHANGE product purchased_product STRING;\nDESCRIBE employee;', 'Syntax: <code>CHANGE old_name new_name TYPE</code>. Only metadata changes; position stays the same.'),
    Q('DDL', 'Create a backup table employee_backup and then drop it.', 'hive', 'CREATE TABLE employee_backup AS SELECT * FROM employee;\nSHOW TABLES;\nDROP TABLE employee_backup;\nSHOW TABLES;', 'First SHOW TABLES: employee, employee_backup. After DROP: employee only.', 'CTAS copies structure + data. <code>CREATE TABLE x LIKE employee</code> copies structure only.'),
    Q('DML', 'Load employee_data.csv from HDFS into the employee table.', 'hive', "LOAD DATA INPATH '/bda/hive/employee_data.csv' OVERWRITE INTO TABLE employee;\nSELECT * FROM employee;", '10 rows, email column = NULL.', 'LOAD DATA INPATH <b>moves</b> the HDFS file into the warehouse, so /bda/hive/employee_data.csv disappears. Put it again if you need to reload. Use LOAD DATA <b>LOCAL</b> INPATH for a Linux file. department.csv is loaded in Q28.'),
    Q('DML', 'Create it_employee and insert only IT employees.', 'hive', "CREATE TABLE it_employee LIKE employee;\nINSERT INTO TABLE it_employee\nSELECT * FROM employee WHERE department = 'IT';\nSELECT * FROM it_employee;", '4 rows: <b>Rahul, Amit, Kiran, Arjun</b>.'),
    Q('DML', 'Create high_salary_employee with salary > 50,000 using INSERT OVERWRITE.', 'hive', 'CREATE TABLE high_salary_employee LIKE employee;\nINSERT OVERWRITE TABLE high_salary_employee\nSELECT * FROM employee WHERE salary > 50000;\nSELECT * FROM high_salary_employee;', '5 rows: <b>Amit 55000, Priya 60000, Anita 65000, Arjun 70000, Rohan 58000</b>.', 'INSERT OVERWRITE replaces existing data; INSERT INTO appends.'),
    Q('DML', 'Export the employee table to an HDFS directory.', 'hive', "EXPORT TABLE employee TO '/bda/hive/export/employee';\nINSERT OVERWRITE DIRECTORY '/bda/hive/employee_out'\nROW FORMAT DELIMITED FIELDS TERMINATED BY ','\nSELECT * FROM employee;\ndfs -ls /bda/hive/export/employee;\ndfs -cat /bda/hive/employee_out/*;", 'Export folder holds <b>_metadata</b> and <b>data/</b>. Method 2 prints rows like <code>101,Rahul,IT,45000,Ahmedabad,Laptop,\\N</code>.', 'The EXPORT target must not already exist. NULL is written as \\N.'),
    Q('DML', 'Import the exported data into another table and verify.', 'hive', "IMPORT TABLE employee_imported FROM '/bda/hive/export/employee';\nSELECT * FROM employee_imported;\nSELECT COUNT(*) AS total_records FROM employee_imported;", 'total_records = <b>10</b>.'),
    Q('DQL', 'Display all records, then only Name, Department, Salary.', 'hive', 'SELECT * FROM employee;\nSELECT name, department, salary FROM employee;', '10 rows each.'),
    Q('DQL', 'Employees in IT with salary > 50,000.', 'hive', "SELECT * FROM employee\nWHERE department = 'IT' AND salary > 50000;", '<b>Amit 55000 (Delhi), Arjun 70000 (Pune)</b>.'),
    Q('DQL', 'Employees from Ahmedabad or Mumbai with salary between 40,000 and 60,000.', 'hive', "SELECT * FROM employee\nWHERE city IN ('Ahmedabad', 'Mumbai')\n  AND salary BETWEEN 40000 AND 60000;", '<b>Rahul, Neha, Kiran, Meena, Rohan</b>. Ravi (Mumbai, 35000) is excluded.', 'BETWEEN includes both ends, so Neha at exactly 40000 appears.'),
    Q('DQL', 'All employees in descending order of salary.', 'hive', 'SELECT * FROM employee ORDER BY salary DESC;', 'Arjun 70000 → Anita → Priya → Rohan → Amit → Kiran → Rahul → Meena → Neha → Ravi 35000.'),
    Q('DQL', 'Three highest-paid employees using ORDER BY and LIMIT.', 'hive', 'SELECT name, department, salary\nFROM employee\nORDER BY salary DESC\nLIMIT 3;', '<b>Arjun 70000, Anita 65000, Priya 60000</b>.'),
    Q('DQL', 'Sort employee records by salary using SORT BY.', 'hive', 'SELECT * FROM employee SORT BY salary DESC;', 'Same as ORDER BY here, because this small file uses a single reducer.'),
    Q('DQL', 'Demonstrate the difference between ORDER BY and SORT BY.', 'hive', 'SET mapreduce.job.reduces=2;\nSELECT name, department, salary FROM employee ORDER BY salary;\nSELECT name, department, salary FROM employee\nDISTRIBUTE BY department\nSORT BY salary;\nSET mapreduce.job.reduces=-1;', 'ORDER BY: fully sorted 35000 → 70000. SORT BY: IT 45000…70000, then HR 35000…, then Finance — sorted inside each reducer only.', 'ORDER BY = total order, one reducer, slow on big data. SORT BY = per-reducer order, parallel, fast.'),
    Q('GROUP', 'Number of employees in each department.', 'hive', 'SELECT department, COUNT(*) AS emp_count\nFROM employee\nGROUP BY department;', '<b>Finance 3, HR 3, IT 4</b>.'),
    Q('GROUP', 'Total and average salary for each department.', 'hive', 'SELECT department,\n       SUM(salary) AS total_salary,\n       ROUND(AVG(salary), 2) AS avg_salary\nFROM employee\nGROUP BY department;', 'Finance <b>183000 / 61000.0</b> · HR <b>117000 / 39000.0</b> · IT <b>220000 / 55000.0</b>.'),
    Q('GROUP', 'Highest and lowest salary in each department.', 'hive', 'SELECT department,\n       MAX(salary) AS max_salary,\n       MIN(salary) AS min_salary\nFROM employee\nGROUP BY department;', 'Finance <b>65000 / 58000</b> · HR <b>42000 / 35000</b> · IT <b>70000 / 45000</b>.'),
    Q('GROUP', 'Number of employees in each city.', 'hive', 'SELECT city, COUNT(*) AS emp_count\nFROM employee\nGROUP BY city;', '<b>Ahmedabad 3, Delhi 2, Mumbai 3, Pune 2</b>.'),
    Q('GROUP', 'Number of employees using each product.', 'hive', 'SELECT purchased_product, COUNT(*) AS emp_count\nFROM employee\nGROUP BY purchased_product;', '<b>Keyboard 1, Laptop 3, Mobile 2, Mouse 2, Tablet 2</b>.', 'Use purchased_product because the column was renamed in Q6.'),
    Q('GROUP', 'Departments having more than two employees (HAVING).', 'hive', 'SELECT department, COUNT(*) AS emp_count\nFROM employee\nGROUP BY department\nHAVING COUNT(*) > 2;', 'All three: <b>Finance 3, HR 3, IT 4</b>.', 'WHERE filters rows before grouping; HAVING filters groups after.'),
    Q('GROUP', 'Departments whose average salary > 50,000.', 'hive', 'SELECT department, ROUND(AVG(salary), 2) AS avg_salary\nFROM employee\nGROUP BY department\nHAVING AVG(salary) > 50000;', '<b>Finance 61000.0, IT 55000.0</b>. HR (39000) is dropped.'),
    Q('GROUP', 'Department-wise report: count, total, average, max, min salary.', 'hive', 'SELECT department,\n       COUNT(*)              AS employee_count,\n       SUM(salary)           AS total_salary,\n       ROUND(AVG(salary), 2) AS average_salary,\n       MAX(salary)           AS maximum_salary,\n       MIN(salary)           AS minimum_salary\nFROM employee\nGROUP BY department\nORDER BY department;', 'Finance 3 · 183000 · 61000.0 · 65000 · 58000<br>HR 3 · 117000 · 39000.0 · 42000 · 35000<br>IT 4 · 220000 · 55000.0 · 70000 · 45000'),
    Q('JOIN', 'Create the department table (Department_ID, Department_Name, Manager) and load department.csv.', 'hive', "CREATE TABLE IF NOT EXISTS department (\n  department_id INT,\n  department_name STRING,\n  manager STRING\n)\nROW FORMAT DELIMITED\nFIELDS TERMINATED BY ','\nSTORED AS TEXTFILE;\nLOAD DATA INPATH '/bda/hive/department.csv' OVERWRITE INTO TABLE department;\nSELECT * FROM department;", '4 rows: IT Mr. Sharma, HR Ms. Patel, Finance Mr. Mehta, Marketing Mr. Shah.', 'The assignment says "employee table" here, but the fields are department fields.'),
    Q('JOIN', 'INNER JOIN: employee name, department and manager.', 'hive', 'SELECT e.name, e.department, d.manager\nFROM employee e\nJOIN department d\n  ON e.department = d.department_name;', '10 rows. <b>Marketing is not shown</b> (no employees).'),
    Q('JOIN', 'LEFT OUTER JOIN: all employees with their managers.', 'hive', 'SELECT e.name, e.department, d.manager\nFROM employee e\nLEFT OUTER JOIN department d\n  ON e.department = d.department_name;', "10 rows, no NULL manager, because every employee's department exists."),
    Q('JOIN', 'RIGHT OUTER JOIN: all departments with their employees.', 'hive', 'SELECT d.department_id, d.department_name, d.manager, e.name\nFROM employee e\nRIGHT OUTER JOIN department d\n  ON e.department = d.department_name;', '11 rows. One row is <b>4 | Marketing | Mr. Shah | NULL</b>.'),
    Q('JOIN', 'FULL OUTER JOIN: identify unmatched employees and departments.', 'hive', 'SELECT e.id, e.name, e.department, d.department_name, d.manager\nFROM employee e\nFULL OUTER JOIN department d\n  ON e.department = d.department_name\nWHERE e.id IS NULL OR d.department_id IS NULL;', 'Unmatched: <b>NULL | NULL | NULL | Marketing | Mr. Shah</b>. No unmatched employees.'),
    Q('NOTES 5–8', 'Practical 5 (notes) · Student table in database IM9 with queries.', 'hive', "CREATE DATABASE IF NOT EXISTS IM9;\nUSE IM9;\nCREATE TABLE Student (Sid INT, Sname STRING, Course STRING, Marks INT)\nROW FORMAT DELIMITED FIELDS TERMINATED BY ','\nSTORED AS TEXTFILE;\nLOAD DATA INPATH '/student/student.csv' INTO TABLE Student;\nSELECT * FROM Student WHERE Course='MCA';\nSELECT COUNT(*), MAX(Marks), MIN(Marks), AVG(Marks), SUM(Marks) FROM Student;\nSELECT * FROM Student ORDER BY Marks DESC;", 'MCA: Rahul 85, Neha 92, Priya 88 · Aggregates: <b>5, 95, 78, 87.6, 438</b> · Top: Riya 95.', 'The bash part creates student.csv and puts it in /student; then the HiveQL runs in the hive shell.', { pre: { m: 'bash', code: 'cat > student.csv << EOF\n101,Rahul,MCA,85\n102,Neha,MCA,92\n103,Amit,BCA,78\n104,Priya,MCA,88\n105,Riya,BCA,95\nEOF\nhdfs dfs -mkdir -p /student\nhdfs dfs -put -f student.csv /student' } }),
    Q('NOTES 5–8', 'Practicals 6–8 (notes) · INSERT OVERWRITE, EXPORT, DROP, IMPORT in CollegeDB.', 'hive', "CREATE DATABASE IF NOT EXISTS CollegeDB;\nUSE CollegeDB;\nCREATE TABLE Employee (EmpID INT, EmpName STRING, Department STRING, Salary INT)\nROW FORMAT DELIMITED FIELDS TERMINATED BY ',' STORED AS TEXTFILE;\nCREATE TABLE EmployeeBackup (EmpID INT, EmpName STRING, Department STRING, Salary INT)\nROW FORMAT DELIMITED FIELDS TERMINATED BY ',' STORED AS TEXTFILE;\nINSERT INTO Employee VALUES (101,'Rahul','HR',45000);\nINSERT INTO Employee VALUES (102,'Neha','IT',65000);\nINSERT INTO Employee VALUES (103,'Amit','Finance',55000);\nINSERT INTO EmployeeBackup VALUES (1,'OldData','OldDept',1000);\nINSERT OVERWRITE TABLE EmployeeBackup SELECT * FROM Employee;\nSELECT * FROM EmployeeBackup;\nEXPORT TABLE Employee TO '/backup/employee';\nDROP TABLE Employee;\nSHOW TABLES;\nIMPORT TABLE Employee FROM '/backup/employee';\nSELECT * FROM Employee;", 'Backup shows only the 3 new rows (OldData is gone). After DROP, SHOW TABLES lists only employeebackup. IMPORT brings back all 3 rows.', 'EXPORT needs an empty or missing target folder, so delete /backup/employee before exporting again.'),
  ] };

/* ---------------- Unit 4 ---------------- */
const U4 = { id: 'u4', label: 'PySpark', sub: 'Unit 4', title: 'Unit 4 · Working with PySpark (RDDs)',
  intro: 'Your uploaded notes did not include Unit 4 material, so these are standard PySpark RDD practicals on the same employee file. Check them against your class notes. Upload employee_data.csv to /bda first.',
  setup: { m: 'py', code: `path = "${PATH}"\nrdd = sc.textFile(path)\nemp = rdd.map(lambda line: line.split(","))` },
  qs: [
    Q('CREATE', 'Create an RDD from a Python list and display it.', 'py', 'nums = sc.parallelize([1, 2, 3, 4, 5])\nprint(nums.collect())\nprint(nums.count())', '<code>[1, 2, 3, 4, 5]</code> and <code>5</code>.', 'In the pyspark shell, sc (SparkContext) and spark (SparkSession) already exist.'),
    Q('CREATE', 'Read the employee file from HDFS into an RDD; show count, first line and first 3 lines.', 'py', `path = "${PATH}"\nrdd = sc.textFile(path)\nprint(rdd.count())\nprint(rdd.first())\nprint(rdd.take(3))`, '<b>10</b>, then <code>101,Rahul,IT,45000,Ahmedabad,Laptop</code>, then a list of 3 lines.', 'textFile is lazy: a wrong path only fails when you call an action such as count().'),
    Q('MAP', 'Split each line into fields and display only names.', 'py', 'emp = rdd.map(lambda line: line.split(","))\nprint(emp.map(lambda x: x[1]).collect())', "<code>['Rahul', 'Neha', 'Amit', … 'Rohan']</code>", 'Field index: 0 ID, 1 Name, 2 Department, 3 Salary, 4 City, 5 Product. Salary is a string, so use int(x[3]).'),
    Q('FILTER', 'Employees with salary greater than 50,000 (name, salary).', 'py', 'high = emp.filter(lambda x: int(x[3]) > 50000) \\\n         .map(lambda x: (x[1], int(x[3])))\nprint(high.collect())', "<code>[('Amit', 55000), ('Priya', 60000), ('Anita', 65000), ('Arjun', 70000), ('Rohan', 58000)]</code>"),
    Q('FILTER', 'Employees of the IT department.', 'py', 'it = emp.filter(lambda x: x[2] == "IT")\nprint(it.map(lambda x: x[1]).collect())', "<code>['Rahul', 'Amit', 'Kiran', 'Arjun']</code>"),
    Q('REDUCE', 'Total salary of all employees.', 'py', 'total = emp.map(lambda x: int(x[3])).reduce(lambda a, b: a + b)\nprint(total)', '<b>520000</b>'),
    Q('REDUCE', 'Number of employees in each department (reduceByKey).', 'py', 'dept_count = emp.map(lambda x: (x[2], 1)) \\\n               .reduceByKey(lambda a, b: a + b)\nprint(dept_count.collect())', "<code>[('IT', 4), ('HR', 3), ('Finance', 3)]</code> (order can vary)."),
    Q('REDUCE', 'Total salary in each department.', 'py', 'dept_sum = emp.map(lambda x: (x[2], int(x[3]))) \\\n             .reduceByKey(lambda a, b: a + b)\nprint(dept_sum.collect())', 'IT <b>220000</b>, HR <b>117000</b>, Finance <b>183000</b>.'),
    Q('REDUCE', 'Average salary in each department.', 'py', 'avg = emp.map(lambda x: (x[2], (int(x[3]), 1))) \\\n        .reduceByKey(lambda a, b: (a[0] + b[0], a[1] + b[1])) \\\n        .mapValues(lambda v: v[0] / v[1])\nprint(avg.collect())', 'IT <b>55000.0</b>, HR <b>39000.0</b>, Finance <b>61000.0</b>.', 'Carry (sum, count) pairs through reduceByKey, then divide with mapValues.'),
    Q('REDUCE', 'Highest salary in each department.', 'py', 'mx = emp.map(lambda x: (x[2], int(x[3]))) \\\n       .reduceByKey(lambda a, b: max(a, b))\nprint(mx.collect())', 'IT 70000, HR 42000, Finance 65000. Use min for lowest: IT 45000, HR 35000, Finance 58000.'),
    Q('SORT', 'Top 3 employees by salary.', 'py', 'top3 = emp.sortBy(lambda x: int(x[3]), ascending=False) \\\n           .map(lambda x: (x[1], int(x[3])))\nprint(top3.take(3))', "<code>[('Arjun', 70000), ('Anita', 65000), ('Priya', 60000)]</code>"),
    Q('OTHER', 'Distinct cities.', 'py', 'print(emp.map(lambda x: x[4]).distinct().collect())', 'Ahmedabad, Mumbai, Delhi, Pune (order can vary).'),
    Q('OTHER', 'Word count in PySpark (Unit 2 input.txt in /input).', 'py', 'text = sc.textFile("hdfs://localhost:9000/input/input.txt")\nwc = text.flatMap(lambda line: line.split()) \\\n         .map(lambda w: (w, 1)) \\\n         .reduceByKey(lambda a, b: a + b)\nprint(wc.collect())', 'Apple 4, Orange 2, Banana 2, Mango 1.', 'flatMap gives one element per word; map would give one list per line.'),
    Q('OTHER', 'Save an RDD result back to HDFS.', 'py', 'dept_sum = emp.map(lambda x: (x[2], int(x[3]))).reduceByKey(lambda a, b: a + b)\ndept_sum.saveAsTextFile("hdfs://localhost:9000/bda/dept_sum_out")', 'Creates a folder with part-00000, part-00001 and _SUCCESS.', 'Fails if the folder already exists: delete it with  hdfs dfs -rm -r /bda/dept_sum_out.'),
    Q('OTHER', 'Convert the RDD into a DataFrame.', 'py', 'rows = emp.map(lambda x: (int(x[0]), x[1], x[2], int(x[3]), x[4], x[5]))\ndf = spark.createDataFrame(rows,\n      ["ID", "Name", "Department", "Salary", "City", "Product"])\ndf.show(3)', 'Prints the first 3 rows as a table. Python ints become <b>long</b> columns in printSchema().'),
  ] };

/* ---------------- Unit 5 ---------------- */
const DFSETUP = `from pyspark.sql import SparkSession\nfrom pyspark.sql.functions import col, round, when, sum, avg, max, min, count\nfrom pyspark.sql.types import StructType, StructField, IntegerType, StringType\n\nspark = SparkSession.builder.appName("EmployeeDataFrame").getOrCreate()\npath = "${PATH}"\nschema = StructType([\n    StructField("ID", IntegerType(), True),\n    StructField("Name", StringType(), True),\n    StructField("Department", StringType(), True),\n    StructField("Salary", IntegerType(), True),\n    StructField("City", StringType(), True),\n    StructField("Product", StringType(), True)\n])\n\ndf = spark.read.csv(path, schema=schema, header=False)`;
const U5 = { id: 'u5', label: 'DataFrames', sub: 'Unit 5', title: 'Unit 5 · PySpark DataFrames',
  intro: 'Run the setup once in pyspark (it imports functions, defines the schema and creates df), then each answer. The file has no header, so an explicit schema is used.',
  setup: { m: 'py', code: DFSETUP },
  qs: [
    Q('READ', 'Read the CSV from HDFS into a DataFrame with ID, Name, Department, Salary, City, Product.', 'py', 'schema = StructType([\n    StructField("ID", IntegerType(), True),\n    StructField("Name", StringType(), True),\n    StructField("Department", StringType(), True),\n    StructField("Salary", IntegerType(), True),\n    StructField("City", StringType(), True),\n    StructField("Product", StringType(), True)\n])\ndf = spark.read.csv(path, schema=schema, header=False)\nprint("DataFrame created with", df.count(), "rows")', '<code>DataFrame created with 10 rows</code>', 'The third argument True = nullable. Needs the imports from the setup block.'),
    Q('READ', 'Display the complete DataFrame.', 'py', 'df.show()', 'All 10 rows as a table. show() prints 20 rows by default.'),
    Q('READ', 'Display the schema.', 'py', 'df.printSchema()', '<code>root |-- ID: integer (nullable = true) …</code> Salary is integer, rest string.'),
    Q('SELECT', 'Display only Name, Department, Salary.', 'py', 'df.select("Name", "Department", "Salary").show()', '10 rows, 3 columns.'),
    Q('SELECT', 'Display only Name and City.', 'py', 'df.select("Name", "City").show()', '10 rows, 2 columns.'),
    Q('SELECT', 'Display the complete DataFrame using select().', 'py', 'df.select("*").show()', 'Same as df.show().'),
    Q('FILTER', 'Employees with salary > 50,000.', 'py', 'df.filter(col("Salary") > 50000).show()', '<b>Amit, Priya, Anita, Arjun, Rohan</b> (5 rows).'),
    Q('FILTER', 'Employees of the IT department.', 'py', 'df.filter(col("Department") == "IT").show()', '<b>Rahul, Amit, Kiran, Arjun</b>.'),
    Q('FILTER', 'Employees from Ahmedabad.', 'py', 'df.filter(col("City") == "Ahmedabad").show()', '<b>Rahul, Kiran, Meena</b>.'),
    Q('FILTER', 'Salary between 40,000 and 60,000.', 'py', 'df.filter(col("Salary").between(40000, 60000)).show()', '7 rows: <b>Rahul, Neha, Amit, Priya, Kiran, Meena, Rohan</b>.', 'between() is inclusive.'),
    Q('FILTER', 'Name and salary of employees earning > 50,000.', 'py', 'df.filter(col("Salary") > 50000).select("Name", "Salary").show()', 'Amit 55000, Priya 60000, Anita 65000, Arjun 70000, Rohan 58000.'),
    Q('FILTER', 'IT employees with salary > 50,000.', 'py', 'df.filter((col("Department") == "IT") & (col("Salary") > 50000)).show()', '<b>Amit 55000, Arjun 70000</b>.', 'Use & | ~ (not and/or/not) and wrap each condition in brackets.'),
    Q('GROUP', 'Number of employees in each department.', 'py', 'df.groupBy("Department").count().orderBy("Department").show()', 'Finance 3, HR 3, IT 4.'),
    Q('GROUP', 'Total salary in each department.', 'py', 'df.groupBy("Department").agg(sum("Salary").alias("Total_Salary")) \\\n  .orderBy("Department").show()', 'Finance <b>183000</b>, HR <b>117000</b>, IT <b>220000</b>.'),
    Q('GROUP', 'Average salary in each department.', 'py', 'df.groupBy("Department").agg(round(avg("Salary"), 2).alias("Average_Salary")) \\\n  .orderBy("Department").show()', 'Finance <b>61000.0</b>, HR <b>39000.0</b>, IT <b>55000.0</b>.'),
    Q('GROUP', 'Highest salary in each department.', 'py', 'df.groupBy("Department").agg(max("Salary").alias("Highest_Salary")) \\\n  .orderBy("Department").show()', 'Finance 65000, HR 42000, IT 70000.'),
    Q('GROUP', 'Lowest salary in each department.', 'py', 'df.groupBy("Department").agg(min("Salary").alias("Lowest_Salary")) \\\n  .orderBy("Department").show()', 'Finance 58000, HR 35000, IT 45000.'),
    Q('SORT', 'All employees in ascending order of salary.', 'py', 'df.orderBy(col("Salary").asc()).show()', 'Ravi 35000 first … Arjun 70000 last.'),
    Q('SORT', 'All employees in descending order of salary.', 'py', 'df.orderBy(col("Salary").desc()).show()', 'Arjun 70000 first … Ravi 35000 last.'),
    Q('SORT', 'Names and salaries in descending order of salary.', 'py', 'df.select("Name", "Salary").orderBy(col("Salary").desc()).show()', 'Arjun, Anita, Priya, Rohan, Amit, Kiran, Rahul, Meena, Neha, Ravi.'),
    Q('COLUMN', 'Add a Bonus column = 10% of salary.', 'py', 'df_bonus = df.withColumn("Bonus", col("Salary") * 0.10)\ndf_bonus.show()', 'Rahul 4500.0 … Arjun 7000.0 (double type).', 'withColumn returns a NEW DataFrame; df itself is unchanged.'),
    Q('COLUMN', 'Add AnnualSalary = salary × 12.', 'py', 'df_annual = df.withColumn("AnnualSalary", col("Salary") * 12)\ndf_annual.show()', 'Rahul 540000, Arjun 840000, Ravi 420000.'),
    Q('COLUMN', 'Add NewSalary after a 5% increment.', 'py', 'df_new = df.withColumn("NewSalary", col("Salary") * 1.05)\ndf_new.show()', 'Rahul 47250.0, Arjun 73500.0, Ravi 36750.0.'),
    Q('COLUMN', 'Add SalaryCategory: ≥ 50,000 High, else Low.', 'py', 'df_cat = df.withColumn("SalaryCategory",\n    when(col("Salary") >= 50000, "High").otherwise("Low"))\ndf_cat.show()', 'High: Amit, Priya, <b>Kiran (exactly 50000)</b>, Anita, Arjun, Rohan. Low: Rahul, Neha, Ravi, Meena.'),
    Q('COLUMN', 'Remove the Product column.', 'py', 'df_no_product = df.drop("Product")\ndf_no_product.show()', '5 columns: ID, Name, Department, Salary, City.'),
    Q('COLUMN', 'Remove City and Product.', 'py', 'df_small = df.drop("City", "Product")\ndf_small.show()', '4 columns: ID, Name, Department, Salary.'),
    Q('STATS', 'Descriptive statistics.', 'py', 'df.describe().show()\ndf.describe("Salary").show()', 'Salary: count <b>10</b>, mean <b>52000.0</b>, stddev <b>11489.125293076057</b>, min <b>35000</b>, max <b>70000</b>. String columns show NULL mean.'),
    Q('STATS', 'Cross-tabulation between Department and City.', 'py', 'df.crosstab("Department", "City").orderBy("Department_City").show()', 'Finance: 0, 1, 1, 1 · HR: 1, 0, 2, 0 · IT: 2, 1, 0, 1 (Ahmedabad, Delhi, Mumbai, Pune)', 'First column is named <code>Department_City</code>.'),
    Q('MIXED', 'Name, department, salary of IT employees earning > 50,000.', 'py', 'df.filter((col("Department") == "IT") & (col("Salary") > 50000)) \\\n  .select("Name", "Department", "Salary").show()', 'Amit IT 55000, Arjun IT 70000.'),
    Q('MIXED', 'Total salary in each city.', 'py', 'df.groupBy("City").agg(sum("Salary").alias("Total_Salary")) \\\n  .orderBy("City").show()', 'Ahmedabad <b>137000</b>, Delhi <b>120000</b>, Mumbai <b>133000</b>, Pune <b>130000</b>.'),
    Q('MIXED', 'Number of employees in each city.', 'py', 'df.groupBy("City").count().orderBy("City").show()', 'Ahmedabad 3, Delhi 2, Mumbai 3, Pune 2.'),
    Q('MIXED', 'Average salary per department in descending order.', 'py', 'df.groupBy("Department") \\\n  .agg(round(avg("Salary"), 2).alias("Average_Salary")) \\\n  .orderBy(col("Average_Salary").desc()).show()', '<b>Finance 61000.0, IT 55000.0, HR 39000.0</b>.'),
    Q('MIXED', 'Add Bonus and display in descending order of bonus.', 'py', 'df.withColumn("Bonus", col("Salary") * 0.10) \\\n  .orderBy(col("Bonus").desc()).show()', 'Arjun 7000.0 first … Ravi 3500.0 last.'),
    Q('MIXED', 'DataFrame with Name, Department, Salary, Bonus for salary > 50,000.', 'py', 'df_high = df.filter(col("Salary") > 50000) \\\n    .withColumn("Bonus", col("Salary") * 0.10) \\\n    .select("Name", "Department", "Salary", "Bonus")\ndf_high.show()', 'Amit 5500.0, Priya 6000.0, Anita 6500.0, Arjun 7000.0, Rohan 5800.0.'),
    Q('MIXED', 'Complete salary analysis: selection, filtering, grouping, sorting, add column, remove column, statistics.', 'py', 'emp = spark.read.csv(path, schema=schema, header=False)\nemp.select("Name", "Department", "Salary").show()\nemp.filter(col("Salary") > 50000).show()\nemp.groupBy("Department").agg(\n    count("ID").alias("Employees"),\n    sum("Salary").alias("Total_Salary"),\n    round(avg("Salary"), 2).alias("Avg_Salary"),\n    max("Salary").alias("Max_Salary"),\n    min("Salary").alias("Min_Salary")\n).orderBy("Department").show()\nemp2 = emp.withColumn("Bonus", col("Salary") * 0.10)\nemp2 = emp2.drop("Product")\nemp2.orderBy(col("Salary").desc()).show()\nemp2.describe("Salary", "Bonus").show()', 'Group table: Finance 3·183000·61000.0·65000·58000 · HR 3·117000·39000.0·42000·35000 · IT 4·220000·55000.0·70000·45000. Bonus: mean 5200.0, min 3500.0, max 7000.0.', 'Likely the "big" question. Remember the order: read, select, filter, group, add column, drop column, sort, describe.'),
    Q('SQL', 'Extra · Same analysis with Spark SQL on a temp view.', 'py', 'df.createOrReplaceTempView("employee")\nspark.sql("SELECT Department, COUNT(*) AS cnt, ROUND(AVG(Salary), 2) AS avg_sal FROM employee GROUP BY Department ORDER BY avg_sal DESC").show()', 'Finance 3 61000.0, IT 4 55000.0, HR 3 39000.0.', 'Not in your solution file; useful if the examiner asks for SQL on a DataFrame (Unit 5 is "PySpark SQL and DataFrame operations").'),
  ] };

/* ---------------- viva ---------------- */
const VIVA = [
  ['HDFS', 'What is the NameNode?', 'The master node of HDFS. It stores metadata only: file names, block locations and permissions.'],
  ['HDFS', 'Does the NameNode store data?', 'No. Actual data blocks are stored on DataNodes.'],
  ['HDFS', 'What does a DataNode do?', 'Stores the actual data blocks and serves them when requested. It sends heartbeats to the NameNode.'],
  ['HDFS', 'Is the SecondaryNameNode a backup of the NameNode?', 'No. It periodically merges fsimage and the edits log into a checkpoint so the NameNode can restart faster.'],
  ['HDFS', 'ResourceManager vs NodeManager?', 'ResourceManager is the YARN master that allocates CPU/memory and schedules applications. NodeManager runs on each worker, launches tasks and reports usage back.'],
  ['HDFS', 'What is jps used for?', 'It lists running Java processes, so you can check that NameNode, DataNode, SecondaryNameNode, ResourceManager and NodeManager are up.'],
  ['HDFS', 'Default block size and replication factor?', 'Block size 128 MB (Hadoop 2/3). Replication factor 3 by default; 1 on a single-node lab setup.'],
  ['HDFS', 'put vs copyFromLocal, get vs copyToLocal?', 'They do the same job. copyFromLocal / copyToLocal only accept the local file system as source / destination; put / get are the general forms.'],
  ['HDFS', 'rm vs rmdir vs rm -r?', 'rm deletes a file. rmdir deletes only an empty directory. rm -r deletes a directory and everything inside it.'],
  ['HDFS', 'Linux head vs hdfs dfs -head?', 'Linux head shows the first 10 lines. hdfs dfs -head shows the first 1 KB of the file.'],
  ['MapReduce', 'What are the phases of a MapReduce job?', 'Input split → Map → Shuffle & Sort (group by key) → Reduce → Output written to HDFS.'],
  ['MapReduce', 'Role of the Mapper, Reducer and Driver?', 'Mapper processes one input record at a time and emits key-value pairs. Reducer receives each key with all its values and produces the final result. Driver configures the Job (classes, types, input/output paths) and submits it.'],
  ['MapReduce', 'What is shuffle and sort?', 'The framework moves all map outputs with the same key to the same reducer and sorts them by key before reduce() is called. That is why sort programs only need to emit the sort field as the key.'],
  ['MapReduce', 'What are Writable types?', 'Hadoop\'s serializable types: Text (String), IntWritable (int), LongWritable (long), DoubleWritable (double), NullWritable (no value).'],
  ['MapReduce', 'Why use NullWritable as the key in the filter program?', 'We do not need grouping, only to pass the whole record through. NullWritable writes nothing for the key, so the output line is just the record.'],
  ['MapReduce', 'What is the input key for TextInputFormat?', 'A LongWritable byte offset of the line in the file; the value is the line as Text. That is why the mapper\'s first generic type is LongWritable or Object.'],
  ['MapReduce', 'Why does a job fail with "Output directory already exists"?', 'Hadoop refuses to overwrite results. Delete the folder (hdfs dfs -rm -r /output) or choose a new output path.'],
  ['MapReduce', '_SUCCESS and part-r-00000?', '_SUCCESS is an empty marker meaning the job finished. part-r-00000 holds the output of reducer 0 (part-m-00000 for map-only jobs).'],
  ['MapReduce', 'What is a Combiner?', 'A mini-reducer that runs on map output before the shuffle to reduce network traffic. For sum and count the reducer class can be reused as the combiner.'],
  ['MapReduce', 'When must you call setMapOutputKeyClass / setMapOutputValueClass?', 'When the mapper\'s output types differ from the final output types, e.g. sort (IntWritable → NullWritable) or average (IntWritable → DoubleWritable).'],
  ['MapReduce', 'Why (double) sum / count in the average reducer?', 'Both are int, so Java would do integer division and drop the decimals. Casting one side to double keeps 45666.67 instead of 45666.'],
  ['Hive', 'What is Hive and why use it instead of MapReduce?', 'A data-warehouse tool on Hadoop. You write SQL-like HiveQL; Hive converts it into MapReduce/Tez jobs, so you avoid writing Java code.'],
  ['Hive', 'What is the Hive metastore?', 'A database (Derby by default, MySQL in production) that stores table schemas, column types and HDFS locations. The data itself stays in HDFS.'],
  ['Hive', 'Managed (internal) vs external table?', 'Managed: Hive owns the data in /user/hive/warehouse; DROP TABLE deletes data and metadata. External (CREATE EXTERNAL TABLE … LOCATION): DROP deletes only metadata, data stays in HDFS.'],
  ['Hive', 'LOAD DATA INPATH vs LOAD DATA LOCAL INPATH?', 'INPATH takes a file already in HDFS and moves it into the table folder. LOCAL INPATH copies a file from the Linux file system.'],
  ['Hive', 'INSERT INTO vs INSERT OVERWRITE?', 'INTO appends rows. OVERWRITE deletes existing data first, then writes.'],
  ['Hive', 'ORDER BY vs SORT BY vs DISTRIBUTE BY vs CLUSTER BY?', 'ORDER BY: global order, one reducer. SORT BY: order inside each reducer. DISTRIBUTE BY: decides which reducer gets a row. CLUSTER BY x = DISTRIBUTE BY x SORT BY x.'],
  ['Hive', 'WHERE vs HAVING?', 'WHERE filters rows before GROUP BY. HAVING filters groups after aggregation and can use COUNT, AVG etc.'],
  ['Hive', 'CTAS vs CREATE TABLE LIKE?', 'CREATE TABLE t AS SELECT copies structure and data. CREATE TABLE t LIKE e copies structure only.'],
  ['Hive', 'What does EXPORT create, and why use IMPORT?', 'A _metadata file (schema) and a data/ folder. IMPORT rebuilds the table from them: used for backup, recovery after DROP, and moving tables between clusters.'],
  ['Hive', 'Why does a column show NULL after loading?', 'The value could not be parsed for its type, the row has fewer fields (like email in Q8), or the table delimiter does not match the file.'],
  ['Spark', 'What is Apache Spark and why is it faster than MapReduce?', 'A distributed in-memory processing engine. It keeps intermediate data in RAM instead of writing to disk after every step, and optimizes the whole job as a DAG.'],
  ['Spark', 'What is an RDD?', 'Resilient Distributed Dataset: an immutable, partitioned collection of records spread across the cluster. Resilient because lost partitions are rebuilt from lineage.'],
  ['Spark', 'Transformations vs actions?', 'Transformations (map, filter, flatMap, reduceByKey, select, withColumn) build a new RDD/DataFrame and are lazy. Actions (collect, count, show, take, first, saveAsTextFile) trigger execution.'],
  ['Spark', 'What is lazy evaluation?', 'Spark only records transformations in a plan (DAG). Nothing runs until an action is called — that is why a wrong file path errors only at count() or collect().'],
  ['Spark', 'map vs flatMap?', 'map gives exactly one output per input. flatMap can give zero or many and flattens them, e.g. one line → many words.'],
  ['Spark', 'reduceByKey vs groupByKey?', 'reduceByKey combines values on each partition before the shuffle, so it moves less data. groupByKey ships all values across the network first.'],
  ['Spark', 'SparkContext vs SparkSession?', 'SparkContext is the old entry point for RDDs. SparkSession (Spark 2+) is the single entry point for DataFrames and SQL and contains the SparkContext (spark.sparkContext).'],
  ['DataFrame', 'RDD vs DataFrame?', 'A DataFrame has named columns and a schema, like a table. The Catalyst optimizer plans DataFrame queries, so they are usually faster and shorter than RDD code.'],
  ['DataFrame', 'Why give an explicit schema and header=False?', 'The CSV has no header row. Without a schema every column is a string named _c0, _c1 …; inferSchema=True guesses types but reads the file twice.'],
  ['DataFrame', 'Why & and | instead of and / or?', 'Conditions are Column objects, not Python booleans. Python\'s and/or cannot be overloaded, so Spark uses & | ~, and each condition needs its own brackets.'],
  ['DataFrame', 'What does withColumn do? Does it change df?', 'Adds or replaces a column and returns a new DataFrame. df is unchanged because DataFrames are immutable.'],
  ['DataFrame', 'show() vs collect()?', 'show() prints the first 20 rows as a table. collect() brings all rows to the driver as a list of Row objects, which can crash the driver on big data.'],
  ['DataFrame', 'What does describe() give? And crosstab?', 'describe(): count, mean, stddev, min, max per column (mean/stddev NULL for strings). crosstab(a, b): a frequency table, one row per value of a, one column per value of b.'],
  ['DataFrame', 'How do you run SQL on a DataFrame?', 'df.createOrReplaceTempView("employee") then spark.sql("SELECT …").show().'],
];

/* ---------------- quiz ---------------- */
const QUIZ = [
  ['Which daemon stores only metadata (file names, block locations)?', ['DataNode', 'NameNode', 'NodeManager', 'SecondaryNameNode'], 1, 'Data blocks live on DataNodes.'],
  ['hdfs dfs -head shows…', ['First 10 lines', 'First 1 KB', 'First 100 bytes', 'The whole file'], 1, 'Linux head = 10 lines; HDFS -head = 1 KB.'],
  ['Which command deletes a non-empty HDFS directory?', ['hdfs dfs -rmdir /x', 'hdfs dfs -rm /x', 'hdfs dfs -rm -r /x', 'hdfs dfs -del /x'], 2, 'rmdir works only on empty directories.'],
  ['hdfs dfs -mkdir /a/b fails when /a does not exist. The fix is…', ['-mkdir -f', '-mkdir -p', '-mkdir -r', 'sudo'], 1, '-p creates missing parents.'],
  ['Running wordcount twice with the same /output gives…', ['It overwrites', 'FileAlreadyExistsException', 'It appends', 'Nothing'], 1, 'Delete the old output folder first.'],
  ['grep example: hadoop jar …examples.jar grep /in /out "Hadoop" on the notes file prints…', ['Hadoop 3', '3\tHadoop', '1\tHadoop', 'Hadoop'], 1, 'Count first, then the matched text.'],
  ['In a sort-by-salary MapReduce job, the salary should be emitted as the…', ['value', 'key', 'counter', 'file name'], 1, 'Shuffle & sort orders keys.'],
  ['Average by department: which reducer output type?', ['IntWritable', 'Text', 'DoubleWritable', 'NullWritable'], 2, 'Averages can have decimals.'],
  ['Which Hive statement deletes existing rows before writing?', ['INSERT INTO', 'INSERT OVERWRITE', 'LOAD DATA LOCAL', 'CREATE TABLE LIKE'], 1, 'OVERWRITE replaces, INTO appends.'],
  ['What happens to the HDFS file after LOAD DATA INPATH?', ['It is copied', 'It is moved into the table folder', 'It is deleted', 'Nothing'], 1, 'INPATH moves the file; that is why you must put it again to reload.'],
  ['Correct syntax to rename product to purchased_product?', ['ALTER TABLE employee RENAME product TO purchased_product;', 'ALTER TABLE employee CHANGE product purchased_product STRING;', 'ALTER TABLE employee MODIFY product purchased_product;', 'RENAME COLUMN product purchased_product;'], 1, 'CHANGE old new TYPE.'],
  ['Which clause guarantees a global sorted output?', ['SORT BY', 'DISTRIBUTE BY', 'ORDER BY', 'GROUP BY'], 2, 'ORDER BY uses a single reducer.'],
  ['HAVING AVG(salary) > 50000 returns which departments?', ['IT only', 'Finance and IT', 'Finance, HR, IT', 'Finance only'], 1, 'Finance 61000, IT 55000, HR 39000.'],
  ['RIGHT OUTER JOIN employee/department returns how many rows?', ['10', '11', '4', '14'], 1, '10 employee rows plus Marketing with NULL name.'],
  ['EXPORT TABLE creates which two things?', ['_SUCCESS and part-r-00000', '_metadata and data/', 'schema.sql and data.csv', 'index and log'], 1, 'IMPORT reads these back.'],
  ['Which is an ACTION in Spark?', ['map', 'filter', 'reduceByKey', 'collect'], 3, 'Actions trigger execution.'],
  ['Total salary of all 10 employees?', ['500000', '520000', '540000', '52000'], 1, 'Mean is 52000, times 10.'],
  ['Splitting lines into words for word count uses…', ['map', 'flatMap', 'filter', 'distinct'], 1, 'flatMap flattens many words per line.'],
  ['Correct PySpark filter for IT AND salary > 50000?', ['df.filter(col("Department")=="IT" and col("Salary")>50000)', 'df.filter((col("Department")=="IT") & (col("Salary")>50000))', 'df.filter(col("Department")=="IT" & col("Salary")>50000)', 'df.where("IT", >50000)'], 1, 'Use & with brackets around each condition.'],
  ['SalaryCategory for Kiran (50000) with when(Salary >= 50000, "High")?', ['High', 'Low', 'NULL', 'Error'], 0, '>= includes 50000.'],
  ['How many rows does between(40000, 60000) return?', ['5', '6', '7', '8'], 2, 'Inclusive: Rahul, Neha, Amit, Priya, Kiran, Meena, Rohan.'],
  ['First column name of df.crosstab("Department","City")?', ['Department', 'City', 'Department_City', 'crosstab'], 2, 'col1_col2.'],
  ['Why header=False when reading employee_data.csv?', ['File is huge', 'File has no header row', 'Speeds reading', 'Required by HDFS'], 1, 'Otherwise row 101 becomes column names.'],
];

const CHECK = [
  'Start services: <code>start-dfs.sh</code> then <code>start-yarn.sh</code>, check with <code>jps</code> (NameNode, DataNode, SecondaryNameNode, ResourceManager, NodeManager).',
  'Create files with <code>nano file</code> (Ctrl+O save, Ctrl+X exit) or <code>cat &gt; file &lt;&lt; EOF</code>. Upload with <code>hdfs dfs -mkdir -p</code> and <code>hdfs dfs -put</code>; verify with <code>hdfs dfs -cat</code>.',
  'Check the NameNode address: <code>hdfs getconf -confKey fs.defaultFS</code>. Change hdfs://localhost:9000 if it differs.',
  'MapReduce output folder must not exist. Delete it with <code>hdfs dfs -rm -r /output</code> before running again.',
  'Java jobs: <code>javac -classpath `hadoop classpath` -d classes *.java</code>, then <code>jar -cvf X.jar -C classes/ .</code>, then <code>hadoop jar X.jar DriverClass /in /out</code>. Forgetting the classpath gives "package org.apache.hadoop.io does not exist".',
  'Hive: type <code>hive</code>. Every statement ends with <code>;</code>. <code>SET hive.cli.print.header=true;</code> shows column names. <code>quit;</code> leaves.',
  'Hive LOAD DATA INPATH moved your file? Run <code>hdfs dfs -put -f</code> again before reloading.',
  'EXPORT fails if the target folder exists: <code>hdfs dfs -rm -r /bda/hive/export/employee</code>.',
  'Spark: <code>pyspark</code> for interactive (spark and sc already exist), or <code>spark-submit file.py</code>. <code>exit()</code> leaves the shell.',
  '<code>NameError: name \'col\' is not defined</code> means you skipped <code>from pyspark.sql.functions import col …</code>.',
];

/* ---------------- practice labs ---------------- */
const H = '/home/hadoop';
const norm = (v) => { const s = String(v).trim(); return /^-?\d+(\.\d+)?$/.test(s) ? String(Number(s)) : s; };
function sameRows(got, exp, ordered) {
  if (!got || got.length !== exp.length) return false;
  const g = got.map(r => r.map(norm).join('|')), e = exp.map(r => r.map(norm).join('|'));
  if (ordered) return g.every((x, i) => x === e[i]);
  return g.slice().sort().join('\n') === e.slice().sort().join('\n');
}
const lastHive = (ev) => ev && ev.kind === 'hive' && ev.type === 'select' ? ev.rows : null;
const lastShow = (ev) => ev && ev.kind === 'py' && ev.type === 'show' ? ev.show.rows : null;
const hiveTable = (m, db, t) => m.hive && m.hive.dbs[db] && m.hive.dbs[db].tables[t];
const hdfsHas = (m, p, re) => m.hdfs.isFile(p) && (!re || re.test(m.hdfs.read(p)));
const ran = (ev, re) => ev && ev.kind === 'shell' && ev.code === 0 && re.test(ev.cmd);
const E = { // employee data helpers for expected rows
  rows: J.EMPLOYEE_CSV.trim().split('\n').map(l => l.split(',')),
};
const sel = (pred, cols) => E.rows.filter(pred).map(r => cols.map(i => r[i]));
const ALL = [0, 1, 2, 3, 4, 5];
const outIs = (m, path, lines) => { const d = m.hdfs.read(path); return d !== null && d.trim().split('\n').join('\n') === lines.join('\n'); };

const LABS = [
  { id: 'l1', unit: 'Unit 1', title: 'Start Hadoop and use HDFS commands', steps: [
    { t: 'Start HDFS', c: 'start-dfs.sh', ok: (m) => m.svc.dfs },
    { t: 'Start YARN', c: 'start-yarn.sh', ok: (m) => m.svc.yarn },
    { t: 'Check the five daemons with jps', c: 'jps', ok: (m, ev) => ev && ev.kind === 'jps' && m.svc.dfs && m.svc.yarn },
    { t: 'Create student.csv in your home folder with 3 rows (1, Rahul, 80 …)', c: 'nano student.csv', ok: (m) => m.local.isFile(H + '/student.csv') && /Rahul/.test(m.local.read(H + '/student.csv')) },
    { t: 'Make the HDFS folder /student', c: 'hdfs dfs -mkdir /student', ok: (m) => m.hdfs.isDir('/student') },
    { t: 'Upload student.csv into /student', c: 'hdfs dfs -put student.csv /student', ok: (m) => m.hdfs.isFile('/student/student.csv') },
    { t: 'List /student', c: 'hdfs dfs -ls /student', ok: (m, ev) => ran(ev, /dfs -ls\s+\/student\/?$/) },
    { t: 'Display the file with cat', c: 'hdfs dfs -cat /student/student.csv', ok: (m, ev) => ran(ev, /dfs -cat\s+\/student\//) },
    { t: 'Create an empty file /student/imscit.txt', c: 'hdfs dfs -touchz /student/imscit.txt', ok: (m) => m.hdfs.isFile('/student/imscit.txt') },
    { t: 'Copy student.csv to student_backup.csv inside HDFS', c: 'hdfs dfs -cp /student/student.csv /student/student_backup.csv', ok: (m) => m.hdfs.isFile('/student/student_backup.csv') },
    { t: 'Download student_backup.csv to ~/Documents', c: 'hdfs dfs -get /student/student_backup.csv ~/Documents/', ok: (m) => m.local.isFile(H + '/Documents/student_backup.csv') },
    { t: 'Rename student.csv to data.csv', c: 'hdfs dfs -mv /student/student.csv /student/data.csv', ok: (m) => m.hdfs.isFile('/student/data.csv') && !m.hdfs.exists('/student/student.csv') },
    { t: 'Count directories, files and size of /student', c: 'hdfs dfs -count /student', ok: (m, ev) => ran(ev, /dfs -count\s+\/student/) },
    { t: 'Show file sizes with du', c: 'hdfs dfs -du /student', ok: (m, ev) => ran(ev, /dfs -du/) },
    { t: 'Delete data.csv', c: 'hdfs dfs -rm /student/data.csv', ok: (m) => m.hdfs.isDir('/student') && !m.hdfs.exists('/student/data.csv') && m.hdfs.exists('/student/student_backup.csv') === m.hdfs.exists('/student/student_backup.csv') && m.events.some(e => e.kind === 'hdfs' && e.op === 'rm' && /data\.csv$/.test(e.path)) },
    { t: 'Delete the whole /student folder', c: 'hdfs dfs -rm -r /student', ok: (m) => !m.hdfs.exists('/student') && m.events.some(e => e.kind === 'hdfs' && e.op === 'rm' && e.path === '/student') },
  ] },
  { id: 'l2', unit: 'Unit 2', title: 'Built-in jobs: WordCount, Grep, MultiFileWordCount', steps: [
    { t: 'Start HDFS and YARN', c: 'start-dfs.sh && start-yarn.sh', ok: (m) => m.svc.dfs && m.svc.yarn },
    { t: 'Create input.txt (Apple Orange Apple / Banana Apple Orange / Mango Apple Banana)', c: 'nano input.txt', ok: (m) => /Apple Orange Apple/.test(m.local.read(H + '/input.txt') || '') },
    { t: 'Upload it to /input', c: 'hdfs dfs -mkdir /input\nhdfs dfs -put input.txt /input', ok: (m) => m.hdfs.isFile('/input/input.txt') },
    { t: 'Run wordcount into /output', c: 'hadoop jar $HADOOP_HOME/share/hadoop/mapreduce/hadoop-mapreduce-examples-*.jar wordcount /input /output', ok: (m) => outIs(m, '/output/part-r-00000', ['Apple\t4', 'Banana\t2', 'Mango\t1', 'Orange\t2']) },
    { t: 'Display /output/part-r-00000', c: 'hdfs dfs -cat /output/part-r-00000', ok: (m, ev) => ran(ev, /-cat\s+\/output\/part-r-00000/) },
    { t: 'Create grep.txt and upload it to /grepinput', c: 'nano grep.txt\nhdfs dfs -mkdir /grepinput\nhdfs dfs -put grep.txt /grepinput', ok: (m) => m.hdfs.isFile('/grepinput/grep.txt') },
    { t: 'Run grep for "Hadoop" into /grepoutput', c: 'hadoop jar $HADOOP_HOME/share/hadoop/mapreduce/hadoop-mapreduce-examples-*.jar grep /grepinput /grepoutput "Hadoop"', ok: (m) => outIs(m, '/grepoutput/part-r-00000', ['3\tHadoop']) },
    { t: 'Create file1.txt and file2.txt, upload both to /multiinput', c: 'hdfs dfs -mkdir /multiinput\nhdfs dfs -put file1.txt file2.txt /multiinput', ok: (m) => m.hdfs.isFile('/multiinput/file1.txt') && m.hdfs.isFile('/multiinput/file2.txt') },
    { t: 'Run multifilewc into /multioutput', c: 'hadoop jar $HADOOP_HOME/share/hadoop/mapreduce/hadoop-mapreduce-examples-*.jar multifilewc /multiinput /multioutput', ok: (m) => outIs(m, '/multioutput/part-r-00000', ['Apple\t3', 'Banana\t1', 'Mango\t2', 'Orange\t2']) },
  ] },
  { id: 'l3', unit: 'Unit 2', title: 'Custom Java job: EmployeeFilter (class notes)', files: { folder: 'EmployeeFilter', files: Object.assign({ 'employee.txt': J.SAMPLE_FILES['employee.txt'] }, J.NOTES_FILTER) }, steps: [
    { t: 'Make the project folder ~/EmployeeFilter and go into it', c: 'mkdir EmployeeFilter\ncd EmployeeFilter', ok: (m) => m.local.isDir(H + '/EmployeeFilter') },
    { t: 'Write the three .java files (or use "Put files in folder" above)', c: 'nano EmployeeFilterMapper.java', ok: (m) => ['Mapper', 'Reducer', 'Driver'].every(k => m.local.isFile(`${H}/EmployeeFilter/EmployeeFilter${k}.java`)) },
    { t: 'Create employee.txt (space separated, 6 rows)', c: 'nano employee.txt', ok: (m) => /Rahul/.test(m.local.read(H + '/EmployeeFilter/employee.txt') || '') },
    { t: 'Compile into classes/', c: 'mkdir classes\njavac -classpath `hadoop classpath` -d classes *.java', ok: (m) => ['Mapper', 'Reducer', 'Driver'].every(k => m.local.isFile(`${H}/EmployeeFilter/classes/EmployeeFilter${k}.class`)) },
    { t: 'Build EmployeeFilter.jar', c: 'jar -cvf EmployeeFilter.jar -C classes/ .', ok: (m) => /EmployeeFilterDriver/.test(m.local.read(H + '/EmployeeFilter/EmployeeFilter.jar') || '') },
    { t: 'Upload employee.txt to /filterinput', c: 'hdfs dfs -mkdir /filterinput\nhdfs dfs -put employee.txt /filterinput', ok: (m) => m.hdfs.isFile('/filterinput/employee.txt') },
    { t: 'Run the job into /filteroutput', c: 'hadoop jar EmployeeFilter.jar EmployeeFilterDriver /filterinput /filteroutput', ok: (m) => outIs(m, '/filteroutput/part-r-00000', ['102 Neha IT 65000', '103 Amit HR 55000', '104 Priya Finance 70000', '106 Karan HR 60000']) },
    { t: 'Display the output', c: 'hdfs dfs -cat /filteroutput/part-r-00000', ok: (m, ev) => ran(ev, /-cat\s+\/filteroutput/) },
  ] },
  ...[11, 14, 7].map((n, k) => { const p = J.PROGRAMS.find(x => x.n === n); return { id: 'lj' + n, unit: 'Unit 2', title: `Java Q${n}: ${p.title}`, files: { folder: p.prefix, files: p.files }, steps: [
    { t: 'Put employee_data.csv in /empinput', c: 'hdfs dfs -mkdir -p /empinput\nhdfs dfs -put employee_data.csv /empinput', ok: (m) => m.hdfs.isFile('/empinput/employee_data.csv') },
    { t: `Write ${p.prefix}Mapper, Reducer and Driver in ~/${p.prefix} (or use "Put files in folder")`, c: `mkdir ${p.prefix}\ncd ${p.prefix}\nnano ${p.prefix}Mapper.java`, ok: (m) => ['Mapper', 'Reducer', 'Driver'].every(x => m.local.isFile(`${H}/${p.prefix}/${p.prefix}${x}.java`)) },
    { t: 'Compile and build the jar', c: `mkdir classes\njavac -classpath \`hadoop classpath\` -d classes *.java\njar -cvf ${p.prefix}.jar -C classes/ .`, ok: (m) => /Driver/.test(m.local.read(`${H}/${p.prefix}/${p.prefix}.jar`) || '') },
    { t: `Run it into /out${n}`, c: `hadoop jar ${p.prefix}.jar ${p.prefix}Driver /empinput /out${n}`, ok: (m) => outIs(m, `/out${n}/part-r-00000`, p.expect) },
    { t: 'Display the result', c: `hdfs dfs -cat /out${n}/part-r-00000`, ok: (m, ev) => ran(ev, new RegExp(`-cat\\s+/out${n}`)) },
  ] }; }),
  { id: 'l4', unit: 'Unit 3', title: 'Hive DDL (Q1–Q8)', steps: [
    { t: 'Put employee_data.csv and department.csv in /bda/hive', c: 'hdfs dfs -mkdir -p /bda/hive\nhdfs dfs -put employee_data.csv department.csv /bda/hive/', ok: (m) => m.hdfs.isFile('/bda/hive/department.csv') || hiveTable(m, 'company_db', 'department') },
    { t: 'Start the Hive shell', c: 'hive', ok: (m) => m.mode() === 'hive' || m.events.some(e => e.kind === 'hive' && e.type === 'start') },
    { t: 'Create database company_db and USE it', c: 'CREATE DATABASE company_db;\nUSE company_db;', ok: (m, ev) => !!(m.hive && m.hive.dbs.company_db) && m.events.some(e => e.kind === 'hive' && e.type === 'use' && e.name === 'company_db') },
    { t: 'Create the employee table (6 columns, comma delimited)', c: "CREATE TABLE employee (id INT, name STRING, department STRING, salary INT, city STRING, product STRING) ROW FORMAT DELIMITED FIELDS TERMINATED BY ',' STORED AS TEXTFILE;", ok: (m) => { const t = hiveTable(m, 'company_db', 'employee'); return t && t.delim === ',' && t.cols.length >= 6; } },
    { t: 'DESCRIBE employee', c: 'DESCRIBE employee;', ok: (m, ev) => ev && ev.kind === 'hive' && ev.type === 'describe' && ev.table === 'employee' },
    { t: 'Add an email column', c: 'ALTER TABLE employee ADD COLUMNS (email STRING);', ok: (m) => { const t = hiveTable(m, 'company_db', 'employee'); return t && t.cols.some(c => c.name === 'email'); } },
    { t: 'Rename product to purchased_product', c: 'ALTER TABLE employee CHANGE product purchased_product STRING;', ok: (m) => { const t = hiveTable(m, 'company_db', 'employee'); return t && t.cols.some(c => c.name === 'purchased_product'); } },
    { t: 'Create employee_backup (CTAS) and drop it', c: 'CREATE TABLE employee_backup AS SELECT * FROM employee;\nDROP TABLE employee_backup;', ok: (m) => m.events.some(e => e.kind === 'hive' && e.type === 'create_table' && e.name === 'employee_backup') && !hiveTable(m, 'company_db', 'employee_backup') },
    { t: 'Load employee_data.csv into employee', c: "LOAD DATA INPATH '/bda/hive/employee_data.csv' OVERWRITE INTO TABLE employee;", ok: (m) => { const t = hiveTable(m, 'company_db', 'employee'); return t && G.HIVE.readTable(m, t).length === 10; } },
    { t: 'SELECT * FROM employee (10 rows)', c: 'SELECT * FROM employee;', ok: (m, ev) => { const r = lastHive(ev); return r && r.length === 10 && r[0].length >= 6; } },
  ] },
  { id: 'l5', unit: 'Unit 3', title: 'Hive DML: INSERT, OVERWRITE, EXPORT, IMPORT (Q9–Q12)', steps: [
    { t: 'it_employee with only IT employees', c: "CREATE TABLE it_employee LIKE employee;\nINSERT INTO TABLE it_employee SELECT * FROM employee WHERE department = 'IT';", ok: (m) => { const t = hiveTable(m, 'company_db', 'it_employee'); return t && G.HIVE.readTable(m, t).length === 4; } },
    { t: 'high_salary_employee with INSERT OVERWRITE (salary > 50000)', c: 'CREATE TABLE high_salary_employee LIKE employee;\nINSERT OVERWRITE TABLE high_salary_employee SELECT * FROM employee WHERE salary > 50000;', ok: (m) => { const t = hiveTable(m, 'company_db', 'high_salary_employee'); return t && G.HIVE.readTable(m, t).length === 5; } },
    { t: 'EXPORT employee to /bda/hive/export/employee', c: "EXPORT TABLE employee TO '/bda/hive/export/employee';", ok: (m) => m.hdfs.isFile('/bda/hive/export/employee/_metadata') },
    { t: 'IMPORT it as employee_imported', c: "IMPORT TABLE employee_imported FROM '/bda/hive/export/employee';", ok: (m) => !!hiveTable(m, 'company_db', 'employee_imported') },
    { t: 'Verify with SELECT COUNT(*) (10)', c: 'SELECT COUNT(*) FROM employee_imported;', ok: (m, ev) => sameRows(lastHive(ev), [['10']]) },
  ] },
  { id: 'l6', unit: 'Unit 3', title: 'Hive queries (Q13–Q27)', steps: [
    { t: 'IT employees with salary > 50000', c: "SELECT * FROM employee WHERE department = 'IT' AND salary > 50000;", ok: (m, ev) => { const r = lastHive(ev); return r && sameRows(r.map(x => x.slice(0, 4)), sel(x => x[2] === 'IT' && +x[3] > 50000, [0, 1, 2, 3])); } },
    { t: 'Ahmedabad or Mumbai, salary 40000–60000', c: "SELECT * FROM employee WHERE city IN ('Ahmedabad','Mumbai') AND salary BETWEEN 40000 AND 60000;", ok: (m, ev) => { const r = lastHive(ev); return r && sameRows(r.map(x => x.slice(0, 2)), sel(x => ['Ahmedabad', 'Mumbai'].includes(x[4]) && +x[3] >= 40000 && +x[3] <= 60000, [0, 1])); } },
    { t: 'Top 3 salaries with ORDER BY … LIMIT', c: 'SELECT name, department, salary FROM employee ORDER BY salary DESC LIMIT 3;', ok: (m, ev) => sameRows(lastHive(ev), [['Arjun', 'IT', '70000'], ['Anita', 'Finance', '65000'], ['Priya', 'Finance', '60000']], true) },
    { t: 'SORT BY with 2 reducers and DISTRIBUTE BY department', c: 'SET mapreduce.job.reduces=2;\nSELECT name, department, salary FROM employee DISTRIBUTE BY department SORT BY salary;', ok: (m, ev) => ev && ev.kind === 'hive' && ev.type === 'select' && /distribute by/.test(ev.sql) },
    { t: 'Count per department', c: 'SELECT department, COUNT(*) FROM employee GROUP BY department;', ok: (m, ev) => sameRows(lastHive(ev), [['Finance', '3'], ['HR', '3'], ['IT', '4']]) },
    { t: 'Total and average salary per department', c: 'SELECT department, SUM(salary), ROUND(AVG(salary),2) FROM employee GROUP BY department;', ok: (m, ev) => sameRows(lastHive(ev), [['Finance', '183000', '61000'], ['HR', '117000', '39000'], ['IT', '220000', '55000']]) },
    { t: 'Departments with average salary > 50000 (HAVING)', c: 'SELECT department, AVG(salary) FROM employee GROUP BY department HAVING AVG(salary) > 50000;', ok: (m, ev) => sameRows(lastHive(ev), [['Finance', '61000'], ['IT', '55000']]) },
    { t: 'Full department report (count, sum, avg, max, min)', c: 'SELECT department, COUNT(*), SUM(salary), ROUND(AVG(salary),2), MAX(salary), MIN(salary) FROM employee GROUP BY department ORDER BY department;', ok: (m, ev) => sameRows(lastHive(ev), [['Finance', '3', '183000', '61000', '65000', '58000'], ['HR', '3', '117000', '39000', '42000', '35000'], ['IT', '4', '220000', '55000', '70000', '45000']]) },
  ] },
  { id: 'l7', unit: 'Unit 3', title: 'Hive joins (Q28–Q32)', steps: [
    { t: 'Create and load the department table', c: "CREATE TABLE department (department_id INT, department_name STRING, manager STRING) ROW FORMAT DELIMITED FIELDS TERMINATED BY ',';\nLOAD DATA INPATH '/bda/hive/department.csv' INTO TABLE department;", ok: (m) => { const t = hiveTable(m, 'company_db', 'department'); return t && G.HIVE.readTable(m, t).length === 4; } },
    { t: 'INNER JOIN: name, department, manager', c: 'SELECT e.name, e.department, d.manager FROM employee e JOIN department d ON e.department = d.department_name;', ok: (m, ev) => { const r = lastHive(ev); return r && r.length === 10 && r.every(x => x.length === 3 && /Mr|Ms/.test(x[2])); } },
    { t: 'LEFT OUTER JOIN', c: 'SELECT e.name, d.manager FROM employee e LEFT OUTER JOIN department d ON e.department = d.department_name;', ok: (m, ev) => ev && ev.kind === 'hive' && /left outer join|left join/.test(ev.sql || '') && lastHive(ev) && lastHive(ev).length === 10 },
    { t: 'RIGHT OUTER JOIN (11 rows, Marketing with NULL)', c: 'SELECT d.department_name, e.name FROM employee e RIGHT OUTER JOIN department d ON e.department = d.department_name;', ok: (m, ev) => { const r = lastHive(ev); return r && r.length === 11 && r.some(x => x.includes('Marketing') && x.includes('NULL')); } },
    { t: 'FULL OUTER JOIN showing only unmatched rows', c: 'SELECT e.id, d.department_name FROM employee e FULL OUTER JOIN department d ON e.department = d.department_name WHERE e.id IS NULL OR d.department_id IS NULL;', ok: (m, ev) => { const r = lastHive(ev); return r && r.length === 1 && r[0].includes('Marketing'); } },
  ] },
  { id: 'l8', unit: 'Unit 4', title: 'PySpark RDDs', steps: [
    { t: 'Upload employee_data.csv to /bda', c: 'hdfs dfs -mkdir -p /bda\nhdfs dfs -put employee_data.csv /bda/', ok: (m) => m.hdfs.isFile('/bda/employee_data.csv') },
    { t: 'Start pyspark', c: 'pyspark', ok: (m) => m.mode() === 'pyspark' || m.events.some(e => e.kind === 'py' && e.type === 'start') },
    { t: 'Read the file with sc.textFile and print count() (10)', c: `rdd = sc.textFile("${PATH}")\nprint(rdd.count())`, ok: (m, ev) => ev && ev.kind === 'py' && ev.type === 'run' && /textFile|count\(\)/.test(ev.src) && m.modes.some(x => x.sess && x.sess.globals.vars.has('rdd')) },
    { t: 'Split lines into fields: emp = rdd.map(lambda line: line.split(","))', c: 'emp = rdd.map(lambda line: line.split(","))', ok: (m) => m.modes.some(x => x.sess && x.sess.globals.vars.has('emp')) },
    { t: 'Collect (name, salary) for salary > 50000', c: 'print(emp.filter(lambda x: int(x[3]) > 50000).map(lambda x: (x[1], int(x[3]))).collect())', ok: (m, ev) => ev && ev.kind === 'py' && ev.type === 'run' && /filter/.test(ev.src) && /50000/.test(ev.src) },
    { t: 'Total salary per department with reduceByKey', c: 'print(emp.map(lambda x: (x[2], int(x[3]))).reduceByKey(lambda a, b: a + b).collect())', ok: (m, ev) => ev && ev.kind === 'py' && ev.type === 'run' && /reduceByKey/.test(ev.src) },
    { t: 'Word count with flatMap on /input/input.txt', c: 'sc.textFile("/input/input.txt").flatMap(lambda l: l.split()).map(lambda w: (w, 1)).reduceByKey(lambda a, b: a + b).collect()', ok: (m, ev) => ev && ev.kind === 'py' && ev.type === 'run' && /flatMap/.test(ev.src) },
  ] },
  { id: 'l9', unit: 'Unit 5', title: 'PySpark DataFrames (Q1–Q12)', steps: [
    { t: 'Upload employee_data.csv to /bda and start pyspark', c: 'hdfs dfs -mkdir -p /bda\nhdfs dfs -put employee_data.csv /bda/\npyspark', ok: (m) => m.hdfs.isFile('/bda/employee_data.csv') && (m.mode() === 'pyspark' || m.events.some(e => e.kind === 'py' && e.type === 'start')) },
    { t: 'Import col, functions and types', c: 'from pyspark.sql.functions import col, round, when, sum, avg, max, min, count\nfrom pyspark.sql.types import StructType, StructField, IntegerType, StringType', ok: (m) => m.modes.some(x => x.sess && x.sess.globals.vars.has('col') && x.sess.globals.vars.has('StructType')) },
    { t: 'Define the schema and read the CSV into df', c: DFSETUP.split('\n').slice(5).join('\n'), ok: (m) => m.modes.some(x => { const d = x.sess && x.sess.globals.vars.get('df'); return d && d.schema && d.rows.length === 10 && d.schema.some(c => c.name === 'Salary' && c.type === 'int'); }) },
    { t: 'df.show() — all 10 rows', c: 'df.show()', ok: (m, ev) => { const r = lastShow(ev); return r && r.length === 10 && r[0].length === 6; } },
    { t: 'Salary greater than 50000', c: 'df.filter(col("Salary") > 50000).show()', ok: (m, ev) => { const r = lastShow(ev); return r && sameRows(r.map(x => x.slice(0, 2)), sel(x => +x[3] > 50000, [0, 1])); } },
    { t: 'Salary between 40000 and 60000', c: 'df.filter(col("Salary").between(40000, 60000)).show()', ok: (m, ev) => { const r = lastShow(ev); return r && r.length === 7; } },
    { t: 'IT and salary > 50000', c: 'df.filter((col("Department") == "IT") & (col("Salary") > 50000)).show()', ok: (m, ev) => { const r = lastShow(ev); return r && r.length === 2 && r.every(x => x.includes('IT')); } },
  ] },
  { id: 'l10', unit: 'Unit 5', title: 'PySpark DataFrames (Q13–Q35)', steps: [
    { t: 'Count per department', c: 'df.groupBy("Department").count().show()', ok: (m, ev) => sameRows(lastShow(ev), [['Finance', '3'], ['HR', '3'], ['IT', '4']]) },
    { t: 'Average salary per department, descending', c: 'df.groupBy("Department").agg(round(avg("Salary"), 2).alias("Average_Salary")).orderBy(col("Average_Salary").desc()).show()', ok: (m, ev) => sameRows(lastShow(ev), [['Finance', '61000'], ['IT', '55000'], ['HR', '39000']], true) },
    { t: 'Add a Bonus column (10%)', c: 'df.withColumn("Bonus", col("Salary") * 0.10).show()', ok: (m, ev) => { const r = lastShow(ev); return r && r.length === 10 && r[0].length === 7 && r.some(x => x[6] === '4500.0'); } },
    { t: 'SalaryCategory with when/otherwise', c: 'df.withColumn("SalaryCategory", when(col("Salary") >= 50000, "High").otherwise("Low")).show()', ok: (m, ev) => { const r = lastShow(ev); return r && r.filter(x => x.includes('High')).length === 6; } },
    { t: 'Drop City and Product', c: 'df.drop("City", "Product").show()', ok: (m, ev) => { const r = lastShow(ev); return r && r.length === 10 && r[0].length === 4; } },
    { t: 'describe()', c: 'df.describe().show()', ok: (m, ev) => { const r = lastShow(ev); return r && r.length === 5 && r[0][0] === 'count'; } },
    { t: 'crosstab Department × City', c: 'df.crosstab("Department", "City").show()', ok: (m, ev) => { const r = lastShow(ev); return r && r.length === 3 && r[0].length === 5; } },
    { t: 'Total salary per city', c: 'df.groupBy("City").agg(sum("Salary").alias("Total_Salary")).orderBy("City").show()', ok: (m, ev) => sameRows(lastShow(ev), [['Ahmedabad', '137000'], ['Delhi', '120000'], ['Mumbai', '133000'], ['Pune', '130000']]) },
    { t: 'Department report with count, sum, avg, max, min (Q35)', c: 'df.groupBy("Department").agg(count("ID").alias("Employees"), sum("Salary").alias("Total_Salary"), round(avg("Salary"), 2).alias("Avg_Salary"), max("Salary").alias("Max_Salary"), min("Salary").alias("Min_Salary")).orderBy("Department").show()', ok: (m, ev) => sameRows(lastShow(ev), [['Finance', '3', '183000', '61000', '65000', '58000'], ['HR', '3', '117000', '39000', '42000', '35000'], ['IT', '4', '220000', '55000', '70000', '45000']]) },
  ] },
];

/* ---------- step-by-step guide text for each lab ---------- */
const GUIDE = {
  l1: { intro: 'Every practical starts here. Hadoop has two parts: HDFS (storage) and YARN (runs jobs). Both must be running before any hdfs, hive or MapReduce command works.', h: [
    'Starts the HDFS daemons: NameNode, DataNode and SecondaryNameNode. You will see three "Starting …" lines. No error means it worked.',
    'Starts YARN: ResourceManager and NodeManager. YARN is needed to run MapReduce jobs and Hive queries.',
    'jps lists running Java processes. You must see all five: NameNode, DataNode, SecondaryNameNode, ResourceManager, NodeManager (plus Jps itself). If one is missing, start it again.',
  ] },
  l1b: { intro: 'Practise every HDFS file command from Unit 1 on one small file. HDFS paths always start with / because HDFS has no home folder by default.', h: [
    'Type nano student.csv to open the editor. Type three lines: 1, Rahul, 80 then 2, Rushabh, 90 then 3, Atik, 70. Press Ctrl+O to save and Ctrl+X to exit. Check with cat student.csv.',
    'mkdir creates a folder inside HDFS (not on Linux). No output means success.',
    'put copies a file from Linux (your home folder) into HDFS. Order: local file first, HDFS folder second.',
    'ls shows what is inside an HDFS folder: "Found 1 items" and a line with size, date and full path.',
    'cat prints the file contents straight from HDFS without downloading it. You should see your three rows.',
    'touchz creates an empty (0 byte) file. Run hdfs dfs -ls /student afterwards to see its size is 0.',
    'cp makes a second copy inside HDFS. Both paths are HDFS paths.',
    'get is the opposite of put: HDFS file first, Linux destination second. ~/Documents/ means the Documents folder in your home. Check with ls ~/Documents.',
    'mv is used to rename (or move). After it, ls /student shows data.csv instead of student.csv.',
    'count prints: number of directories, number of files, total bytes, path. The folder itself counts as 1 directory.',
    'du shows the size of each file in the folder. Add -s for one total, -h for KB/MB.',
    'rm deletes one file and prints "Deleted /student/data.csv".',
    'rm -r deletes a folder and everything inside it. (rmdir only works on an empty folder.)',
  ] },
  l2: { intro: 'Hadoop ships with ready-made example jobs inside one jar file. You only need an input folder in HDFS and a new output folder name.', h: [
    'Both must be running (check with jps). The && runs the second command only if the first succeeds.',
    'Open nano input.txt and type: Apple Orange Apple / Banana Apple Orange / Mango Apple Banana (one per line). Ctrl+O, Ctrl+X.',
    'Create /input in HDFS and copy input.txt into it. MapReduce reads every file in the input folder.',
    'Runs the WordCount job. Format: hadoop jar <jar> wordcount <input folder> <output folder>. The output folder must NOT exist yet. Wait for "completed successfully" and the counters.',
    'part-r-00000 is the reducer output. Expect: Apple 4, Banana 2, Mango 1, Orange 2. The folder also holds an empty _SUCCESS file.',
    'Make grep.txt with nano (one line: Hadoop is Big Data Spark is Fast Hive works on Hadoop Hadoop is Open Source), then create /grepinput and put the file in it.',
    'grep takes: input, output, then the word to search. Then run hdfs dfs -cat /grepoutput/part-r-00000. Expect 3 Hadoop (count first).',
    'Make file1.txt (Apple Mango Banana Apple) and file2.txt (Apple Orange Mango Orange) with nano or "Add practice files", then upload BOTH into one folder.',
    'multifilewc counts words across all files in the folder together. Expect Apple 3, Banana 1, Mango 2, Orange 2 (view with -cat /multioutput/part-r-00000).',
  ] },
  l3: { intro: 'Write your own MapReduce program in Java: a Mapper (filters each line), a Reducer (writes records out) and a Driver (configures and starts the job). Then compile, pack into a jar and run.', h: [
    'Keep each Java project in its own folder. cd moves you into it; the prompt changes to ~/EmployeeFilter.',
    'Type each file with nano (copy from the Notes tab, Unit 2 Q4) — or press "Put the .java files" at the top of this panel. The file name must match the public class name exactly.',
    'nano employee.txt and type the 6 space-separated rows (101 Rahul HR 45000 …).',
    'mkdir classes makes the output folder. javac compiles all .java files; -classpath `hadoop classpath` lets Java find the Hadoop libraries (without it: "package org.apache.hadoop.io does not exist"). Check with ls classes — three .class files.',
    'jar -cvf <name>.jar -C classes/ . packs every class inside classes/ into one jar. You will see "adding: …class" lines.',
    'The job reads from HDFS, so the input file must be in an HDFS folder.',
    'Format: hadoop jar <your jar> <Driver class name> <input> <output>. If you see "Output directory already exists", delete it with hdfs dfs -rm -r /filteroutput.',
    'Expect only salary > 50000: Neha, Amit, Priya, Karan.',
  ] },
  java: { intro: 'Same 3-file pattern as the EmployeeFilter lab, now on employee_data.csv (comma separated). The Mapper picks the key and value, the Reducer does the maths.', h: [
    'Run "Add practice files" if employee_data.csv is not in your home folder (ls to check). Then make /empinput and upload it.',
    'Create the folder and the three files (Mapper, Reducer, Driver). Copy them from Notes → Unit 2, or use the "Put the .java files" button above.',
    'Same three commands every time: mkdir classes, javac with the hadoop classpath, jar -cvf. Fix any javac error before going on — the line number is shown.',
    'Run the Driver class with input /empinput and a new output folder.',
    'Print the result file and compare with the expected output in the Notes tab.',
  ] },
  l4: { intro: 'Hive lets you use SQL on files stored in HDFS. Every statement ends with a semicolon. Turn on column names with SET hive.cli.print.header=true;', h: [
    'Use "Add practice files" if the CSVs are not in your home folder. Hive will read them from HDFS, so upload both to /bda/hive.',
    'Type hive at the $ prompt. The prompt changes to hive>. To leave later, type quit;',
    'A database is a folder for tables. USE makes it the current one, so new tables go inside it.',
    'Columns must be in the same order as the CSV. FIELDS TERMINATED BY \',\' tells Hive the file is comma separated — without it every column loads as NULL.',
    'DESCRIBE shows each column name and type. Check that you have 6 columns.',
    'ADD COLUMNS adds email at the end. Old rows will show NULL for it.',
    'CHANGE old new TYPE renames a column. Later questions use purchased_product.',
    'CREATE TABLE … AS SELECT copies structure and data. SHOW TABLES to see it, then DROP TABLE to remove it.',
    'LOAD DATA INPATH moves the HDFS file into the table. OVERWRITE replaces any old data. The file disappears from /bda/hive afterwards — that is normal.',
    'Should print all 10 employees, with NULL in the email column.',
  ] },
  l5: { intro: 'Copy data between tables, then back a table up to HDFS and restore it.', h: [
    'LIKE copies only the structure. INSERT INTO … SELECT … WHERE then copies the IT rows. Hive runs a small MapReduce job (you see Stage-1 map = 100%).',
    'INSERT OVERWRITE first deletes anything already in the table, then writes the 5 high-salary rows.',
    'EXPORT writes a _metadata file and a data/ folder. The target folder must not exist yet.',
    'IMPORT recreates the table (structure + data) from the exported folder under a new name.',
    'COUNT(*) should be 10, the same as employee.',
  ] },
  l6: { intro: 'SELECT queries with WHERE, ORDER BY, LIMIT, GROUP BY and HAVING. Compare your output with the Notes tab.', h: [
    'Two conditions joined with AND. Strings go in single quotes. Expect Amit and Arjun.',
    'IN lists allowed values; BETWEEN includes both ends. Expect Rahul, Neha, Kiran, Meena, Rohan.',
    'ORDER BY … DESC sorts highest first, LIMIT 3 keeps the top three: Arjun, Anita, Priya.',
    'SET mapreduce.job.reduces=2 uses two reducers. SORT BY only sorts inside each reducer, so the output is sorted per department, not overall. Set it back with SET mapreduce.job.reduces=-1;',
    'GROUP BY makes one row per department; COUNT(*) counts its rows. Expect Finance 3, HR 3, IT 4.',
    'SUM and AVG per department. ROUND(x, 2) keeps two decimals.',
    'HAVING filters groups after GROUP BY (WHERE cannot use AVG). Expect Finance and IT.',
    'One query with all five aggregate functions. Add aliases with AS to name the columns.',
  ] },
  l7: { intro: 'Join employee with department on the department name.', h: [
    'Create the table with 3 columns and load department.csv from /bda/hive.',
    'JOIN … ON matches rows where e.department = d.department_name. e and d are short aliases. 10 rows; Marketing is missing because nobody works there.',
    'LEFT OUTER JOIN keeps every employee even without a match. Here all 10 have a manager.',
    'RIGHT OUTER JOIN keeps every department. Marketing appears with NULL for the employee name (11 rows).',
    'FULL OUTER JOIN keeps both sides; the WHERE … IS NULL keeps only rows with no partner — just Marketing.',
  ] },
  l8: { intro: 'An RDD is a distributed list of lines. You transform it with map / filter / reduceByKey and see results only when you call an action like collect() or count().', h: [
    'Spark reads from HDFS, so the file must be uploaded first.',
    'Type pyspark at the $ prompt. The prompt becomes >>>. sc and spark already exist. Leave with exit().',
    'textFile creates an RDD with one element per line. count() is an action, so it actually reads the file: expect 10.',
    'map runs the lambda on every line; split(",") turns a line into a list of 6 fields. Index 1 = Name, 3 = Salary.',
    'filter keeps lines where the lambda is True. int(x[3]) converts the salary text to a number. map then builds (name, salary) pairs.',
    'map to (department, salary) pairs; reduceByKey adds the values of the same key. Expect IT 220000, HR 117000, Finance 183000.',
    'flatMap splits each line into many words; each word becomes (word, 1); reduceByKey adds them. Upload input.txt to /input first if you have not.',
  ] },
  l9: { intro: 'A DataFrame is a table with named columns. Read the CSV with an explicit schema, then select and filter.', h: [
    'Upload the file to /bda, then type pyspark. Everything after this happens at the >>> prompt.',
    'col, sum, avg … come from pyspark.sql.functions; StructType etc. from pyspark.sql.types. Without the import you get NameError: name \'col\' is not defined.',
    'The schema lists each column name and type in file order. header=False because the CSV has no header row. Paste the whole block at once — the ... prompt means Python is waiting for the closing bracket.',
    'show() prints up to 20 rows as a table.',
    'col("Salary") > 50000 builds a condition; filter keeps matching rows. Expect 5 rows.',
    'between(40000, 60000) includes both ends. Expect 7 rows.',
    'Combine conditions with & and put brackets around each one. Using and gives an error.',
  ] },
  l10: { intro: 'Grouping, new columns, statistics and the full Q35 analysis. df must already exist (finish the previous lab first).', h: [
    'groupBy then count() gives one row per department.',
    'agg(...) lets you choose the aggregate; alias names the column; orderBy(col(...).desc()) sorts highest first.',
    'withColumn adds a new column computed from Salary. df itself does not change — it returns a new DataFrame.',
    'when(condition, value).otherwise(value) works like IF/ELSE. 50000 counts as High because of >=.',
    'drop removes columns. You can list several names.',
    'describe() shows count, mean, stddev, min and max for every column.',
    'crosstab counts each Department × City pair; the first column is called Department_City.',
    'Same as the department total but grouped by City.',
    'All five aggregates in one agg(...) call — this is the core of Q35.',
  ] },
};
// split Unit 1 into "start" and "HDFS commands"
(function () {
  const l1 = LABS.find(l => l.id === 'l1');
  const rest = l1.steps.splice(3);
  l1.title = 'Start Hadoop and check the daemons';
  LABS.splice(LABS.indexOf(l1) + 1, 0, { id: 'l1b', unit: 'Unit 1', title: 'HDFS file commands (mkdir, put, cat, get, cp, mv, rm …)', steps: rest });
  for (const lab of LABS) {
    const g = GUIDE[lab.id] || (lab.id.startsWith('lj') ? GUIDE.java : null);
    if (!g) continue;
    lab.intro = g.intro;
    lab.steps.forEach((st, i) => { if (g.h[i]) st.h = g.h[i]; });
  }
})();

G.CONTENT = { UNITS: [U1, U2, U3, U4, U5], VIVA, QUIZ, CHECK, LABS, sameRows };
})(typeof window !== 'undefined' ? window : globalThis);
