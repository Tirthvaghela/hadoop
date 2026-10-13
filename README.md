# BDA Lab — Hadoop · HDFS · MapReduce · Hive · PySpark simulator

A browser-based practice terminal for the GLS University IMSCIT Semester IX
Big Data Analytics practicals (Units 1–5). Everything runs in the browser and
is saved in your device's local storage — no server or Hadoop install needed.

## What you can practise
- **Unit 1 – HDFS:** `start-dfs.sh`, `start-yarn.sh`, `jps`, every `hdfs dfs` command
- **Unit 2 – MapReduce:** built-in `wordcount`, `grep`, `multifilewc`, and your own
  Java Mapper/Reducer/Driver with `javac`, `jar`, `hadoop jar`
- **Unit 3 – Hive:** DDL, LOAD, INSERT / OVERWRITE, EXPORT / IMPORT, GROUP BY, HAVING, joins
- **Unit 4 – PySpark RDDs:** `sc.textFile`, `map`, `filter`, `reduceByKey`, `saveAsTextFile`
- **Unit 5 – DataFrames:** schema, `select`, `filter`, `groupBy`, `withColumn`, `describe`, `crosstab`, `spark.sql`

Includes a step-by-step practice guide per unit, notes with answers, viva questions,
a quiz and an exam-day checklist.

## Run locally
Open `index.html` in a browser, or serve the folder: `python3 -m http.server`.

Made by Tirth Vaghela.
