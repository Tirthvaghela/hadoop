/* ===== Unit 2 Java solutions (generated from templates) ===== */
(function (G) {
'use strict';
const IMPORTS = {
  io: 'import java.io.IOException;',
  Text: 'import org.apache.hadoop.io.Text;', IntWritable: 'import org.apache.hadoop.io.IntWritable;', DoubleWritable: 'import org.apache.hadoop.io.DoubleWritable;', NullWritable: 'import org.apache.hadoop.io.NullWritable;', LongWritable: 'import org.apache.hadoop.io.LongWritable;',
  Mapper: 'import org.apache.hadoop.mapreduce.Mapper;', Reducer: 'import org.apache.hadoop.mapreduce.Reducer;',
};
const imp = (...k) => [IMPORTS.io, ...k.map(x => IMPORTS[x])].join('\n');
function driver(name, mapper, reducer, jobName, outK, outV, mapK, mapV) {
  const types = [...new Set([outK, outV, mapK, mapV].filter(Boolean))];
  return `import org.apache.hadoop.conf.Configuration;
import org.apache.hadoop.fs.Path;
${types.map(t => `import org.apache.hadoop.io.${t};`).join('\n')}
import org.apache.hadoop.mapreduce.Job;
import org.apache.hadoop.mapreduce.lib.input.FileInputFormat;
import org.apache.hadoop.mapreduce.lib.output.FileOutputFormat;

public class ${name} {
    public static void main(String[] args) throws Exception {
        Configuration conf = new Configuration();
        Job job = Job.getInstance(conf, "${jobName}");
        job.setJarByClass(${name}.class);
        job.setMapperClass(${mapper}.class);
        job.setReducerClass(${reducer}.class);
${mapK ? `        job.setMapOutputKeyClass(${mapK}.class);\n        job.setMapOutputValueClass(${mapV}.class);\n` : ''}        job.setOutputKeyClass(${outK}.class);
        job.setOutputValueClass(${outV}.class);
        FileInputFormat.addInputPath(job, new Path(args[0]));
        FileOutputFormat.setOutputPath(job, new Path(args[1]));
        System.exit(job.waitForCompletion(true) ? 0 : 1);
    }
}
`;
}
/* filter: keep whole record when cond(data) is true */
function filterProg(prefix, condLines, jobName) {
  const M = prefix + 'Mapper', R = prefix + 'Reducer', D = prefix + 'Driver';
  return {
    [M + '.java']: `${imp('NullWritable', 'Text', 'Mapper')}

public class ${M} extends Mapper<Object, Text, NullWritable, Text> {
    public void map(Object key, Text value, Context context)
            throws IOException, InterruptedException {
        String[] data = value.toString().split(",");
        if (data.length == 6) {
${condLines}
                context.write(NullWritable.get(), value);
            }
        }
    }
}
`,
    [R + '.java']: `${imp('NullWritable', 'Text', 'Reducer')}

public class ${R} extends Reducer<NullWritable, Text, NullWritable, Text> {
    public void reduce(NullWritable key, Iterable<Text> values, Context context)
            throws IOException, InterruptedException {
        for (Text value : values) {
            context.write(NullWritable.get(), value);
        }
    }
}
`,
    [D + '.java']: driver(D, M, R, jobName, 'NullWritable', 'Text'),
  };
}
/* sort: key = field, value = record; framework sorts keys */
function sortProg(prefix, keyType, keyExpr, jobName) {
  const M = prefix + 'Mapper', R = prefix + 'Reducer', D = prefix + 'Driver';
  return {
    [M + '.java']: `${imp(keyType, ...(keyType === 'Text' ? [] : ['Text']), 'Mapper')}

public class ${M} extends Mapper<Object, Text, ${keyType}, Text> {
    public void map(Object key, Text value, Context context)
            throws IOException, InterruptedException {
        String[] data = value.toString().split(",");
        if (data.length == 6) {
            context.write(new ${keyType}(${keyExpr}), value);
        }
    }
}
`,
    [R + '.java']: `${imp(...(keyType === 'Text' ? [] : [keyType]), 'NullWritable', 'Text', 'Reducer')}

public class ${R} extends Reducer<${keyType}, Text, NullWritable, Text> {
    public void reduce(${keyType} key, Iterable<Text> values, Context context)
            throws IOException, InterruptedException {
        for (Text value : values) {
            context.write(NullWritable.get(), value);
        }
    }
}
`,
    [D + '.java']: driver(D, M, R, jobName, 'NullWritable', 'Text', keyType, 'Text'),
  };
}
/* aggregate: key = group (Text), value = number; reducer folds */
function aggProg(prefix, keyExpr, valueExpr, kind, jobName) {
  const M = prefix + 'Mapper', R = prefix + 'Reducer', D = prefix + 'Driver';
  const outV = kind === 'avg' ? 'DoubleWritable' : 'IntWritable';
  const body = {
    sum: `        int sum = 0;
        for (IntWritable value : values) {
            sum += value.get();
        }
        context.write(key, new IntWritable(sum));`,
    count: `        int count = 0;
        for (IntWritable value : values) {
            count += value.get();
        }
        context.write(key, new IntWritable(count));`,
    avg: `        int sum = 0;
        int count = 0;
        for (IntWritable value : values) {
            sum += value.get();
            count++;
        }
        double average = (double) sum / count;
        context.write(key, new DoubleWritable(average));`,
    max: `        int max = Integer.MIN_VALUE;
        for (IntWritable value : values) {
            max = Math.max(max, value.get());
        }
        context.write(key, new IntWritable(max));`,
    min: `        int min = Integer.MAX_VALUE;
        for (IntWritable value : values) {
            min = Math.min(min, value.get());
        }
        context.write(key, new IntWritable(min));`,
  }[kind];
  return {
    [M + '.java']: `${imp('IntWritable', 'Text', 'Mapper')}

public class ${M} extends Mapper<Object, Text, Text, IntWritable> {
    public void map(Object key, Text value, Context context)
            throws IOException, InterruptedException {
        String[] data = value.toString().split(",");
        if (data.length == 6) {
            context.write(new Text(${keyExpr}), new IntWritable(${valueExpr}));
        }
    }
}
`,
    [R + '.java']: `${imp('IntWritable', ...(outV === 'DoubleWritable' ? ['DoubleWritable'] : []), 'Text', 'Reducer')}

public class ${R} extends Reducer<Text, IntWritable, Text, ${outV}> {
    public void reduce(Text key, Iterable<IntWritable> values, Context context)
            throws IOException, InterruptedException {
${body}
    }
}
`,
    [D + '.java']: driver(D, M, R, jobName, 'Text', outV, outV === 'IntWritable' ? null : 'Text', outV === 'IntWritable' ? null : 'IntWritable'),
  };
}
const SAL = 'Integer.parseInt(data[3])';
const PROGRAMS = [
  { n: 4, title: 'Filter employees with salary > 50,000', prefix: 'SalaryFilter', files: filterProg('SalaryFilter', `            int salary = Integer.parseInt(data[3]);\n            if (salary > 50000) {`, 'Salary Filter'),
    expect: ['103,Amit,IT,55000,Delhi,Laptop', '104,Priya,Finance,60000,Pune,Tablet', '107,Anita,Finance,65000,Delhi,Laptop', '108,Arjun,IT,70000,Pune,Keyboard', '110,Rohan,Finance,58000,Mumbai,Mouse'], idea: 'Mapper checks data[3] and writes only matching records with a NullWritable key. The reducer just copies them out.' },
  { n: 5, title: 'Filter employees by department (IT)', prefix: 'DeptFilter', files: filterProg('DeptFilter', `            String department = data[2];\n            if (department.equals("IT")) {`, 'Department Filter'),
    expect: ['101,Rahul,IT,45000,Ahmedabad,Laptop', '103,Amit,IT,55000,Delhi,Laptop', '105,Kiran,IT,50000,Ahmedabad,Mouse', '108,Arjun,IT,70000,Pune,Keyboard'], idea: 'Same as Q4 but compares the department field with equals() — never use == for Strings in Java.' },
  { n: 6, title: 'Filter employees by city (Ahmedabad)', prefix: 'CityFilter', files: filterProg('CityFilter', `            String city = data[4];\n            if (city.equalsIgnoreCase("Ahmedabad")) {`, 'City Filter'),
    expect: ['101,Rahul,IT,45000,Ahmedabad,Laptop', '105,Kiran,IT,50000,Ahmedabad,Mouse', '109,Meena,HR,42000,Ahmedabad,Tablet'], idea: 'City is index 4. equalsIgnoreCase also accepts "ahmedabad".' },
  { n: 7, title: 'Sort employees by salary', prefix: 'SalarySort', files: sortProg('SalarySort', 'IntWritable', SAL, 'Sort by Salary'),
    expect: ['106,Ravi,HR,35000,Mumbai,Mobile', '102,Neha,HR,40000,Mumbai,Mobile', '109,Meena,HR,42000,Ahmedabad,Tablet', '101,Rahul,IT,45000,Ahmedabad,Laptop', '105,Kiran,IT,50000,Ahmedabad,Mouse', '103,Amit,IT,55000,Delhi,Laptop', '110,Rohan,Finance,58000,Mumbai,Mouse', '104,Priya,Finance,60000,Pune,Tablet', '107,Anita,Finance,65000,Delhi,Laptop', '108,Arjun,IT,70000,Pune,Keyboard'], idea: 'Emit salary as the KEY. Shuffle & sort orders keys automatically (ascending). Map output types differ from final output, so the driver sets setMapOutputKeyClass/ValueClass.' },
  { n: 8, title: 'Sort employees by name', prefix: 'NameSort', files: sortProg('NameSort', 'Text', 'data[1]', 'Sort by Name'),
    expect: ['107,Anita,Finance,65000,Delhi,Laptop', '108,Arjun,IT,70000,Pune,Keyboard', '103,Amit,IT,55000,Delhi,Laptop', '105,Kiran,IT,50000,Ahmedabad,Mouse', '109,Meena,HR,42000,Ahmedabad,Tablet', '102,Neha,HR,40000,Mumbai,Mobile', '104,Priya,Finance,60000,Pune,Tablet', '101,Rahul,IT,45000,Ahmedabad,Laptop', '106,Ravi,HR,35000,Mumbai,Mobile', '110,Rohan,Finance,58000,Mumbai,Mouse'], idea: 'Text keys sort alphabetically (byte order), so Amit comes after Anita? No — "Ami" < "Ani", check the real output below.' },
  { n: 9, title: 'Sort employees by department', prefix: 'DeptSort', files: sortProg('DeptSort', 'Text', 'data[2]', 'Sort by Department'),
    expect: ['104,Priya,Finance,60000,Pune,Tablet', '107,Anita,Finance,65000,Delhi,Laptop', '110,Rohan,Finance,58000,Mumbai,Mouse', '102,Neha,HR,40000,Mumbai,Mobile', '106,Ravi,HR,35000,Mumbai,Mobile', '109,Meena,HR,42000,Ahmedabad,Tablet', '101,Rahul,IT,45000,Ahmedabad,Laptop', '103,Amit,IT,55000,Delhi,Laptop', '105,Kiran,IT,50000,Ahmedabad,Mouse', '108,Arjun,IT,70000,Pune,Keyboard'], idea: 'Department as key: Finance < HR < IT. Records inside one department keep input order.' },
  { n: 10, title: 'Total salary of all employees', prefix: 'TotalSalary', files: aggProg('TotalSalary', '"TotalSalary"', SAL, 'sum', 'Total Salary'), expect: ['TotalSalary\t520000'], idea: 'Every record uses the same constant key, so one reducer call receives all 10 salaries.' },
  { n: 11, title: 'Total salary by department', prefix: 'DeptSalary', files: aggProg('DeptSalary', 'data[2]', SAL, 'sum', 'Department Salary'), expect: ['Finance\t183000', 'HR\t117000', 'IT\t220000'], idea: 'Key = department, value = salary; reducer sums.' },
  { n: 12, title: 'Total salary by city', prefix: 'CitySalary', files: aggProg('CitySalary', 'data[4]', SAL, 'sum', 'City Salary'), expect: ['Ahmedabad\t137000', 'Delhi\t120000', 'Mumbai\t133000', 'Pune\t130000'], idea: 'Key = city (index 4).' },
  { n: 13, title: 'Average salary of all employees', prefix: 'AvgSalary', files: aggProg('AvgSalary', '"AverageSalary"', SAL, 'avg', 'Average Salary'), expect: ['AverageSalary\t52000.0'], idea: 'Reducer keeps sum and count, then (double) sum / count. Without the cast Java does integer division.' },
  { n: 14, title: 'Average salary by department', prefix: 'DeptAvg', files: aggProg('DeptAvg', 'data[2]', SAL, 'avg', 'Department Average'), expect: ['Finance\t61000.0', 'HR\t39000.0', 'IT\t55000.0'], idea: 'Output value is DoubleWritable, so the driver must also set the map output types (Text, IntWritable).' },
  { n: 15, title: 'Average salary by city', prefix: 'CityAvg', files: aggProg('CityAvg', 'data[4]', SAL, 'avg', 'City Average'), expect: ['Ahmedabad\t45666.666666666664', 'Delhi\t60000.0', 'Mumbai\t44333.333333333336', 'Pune\t65000.0'], idea: '137000 / 3 is not a whole number — that is why the cast to double matters.' },
  { n: 16, title: 'Highest salary by department', prefix: 'DeptMax', files: aggProg('DeptMax', 'data[2]', SAL, 'max', 'Department Max'), expect: ['Finance\t65000', 'HR\t42000', 'IT\t70000'], idea: 'Start max at Integer.MIN_VALUE and use Math.max.' },
  { n: 17, title: 'Lowest salary by department', prefix: 'DeptMin', files: aggProg('DeptMin', 'data[2]', SAL, 'min', 'Department Min'), expect: ['Finance\t58000', 'HR\t35000', 'IT\t45000'], idea: 'Start min at Integer.MAX_VALUE and use Math.min.' },
  { n: 18, title: 'Number of employees by department', prefix: 'DeptCount', files: aggProg('DeptCount', 'data[2]', '1', 'count', 'Department Count'), expect: ['Finance\t3', 'HR\t3', 'IT\t4'], idea: 'Emit (department, 1) — exactly like WordCount, with the department as the "word".' },
];
// fix sort-by-name expectation using real byte order
PROGRAMS[4].expect = ['103,Amit,IT,55000,Delhi,Laptop', '107,Anita,Finance,65000,Delhi,Laptop', '108,Arjun,IT,70000,Pune,Keyboard', '105,Kiran,IT,50000,Ahmedabad,Mouse', '109,Meena,HR,42000,Ahmedabad,Tablet', '102,Neha,HR,40000,Mumbai,Mobile', '104,Priya,Finance,60000,Pune,Tablet', '101,Rahul,IT,45000,Ahmedabad,Laptop', '106,Ravi,HR,35000,Mumbai,Mobile', '110,Rohan,Finance,58000,Mumbai,Mouse'];
PROGRAMS[4].idea = 'Name as a Text key: Hadoop sorts Text keys alphabetically, so Amit, Anita, Arjun … Rohan.';

/* Practical 4 from the class notes (space separated, 4 fields) */
const NOTES_FILTER = {
  'EmployeeFilterMapper.java': `import java.io.IOException;
import org.apache.hadoop.io.NullWritable;
import org.apache.hadoop.io.Text;
import org.apache.hadoop.mapreduce.Mapper;

public class EmployeeFilterMapper extends Mapper<Object, Text,
        NullWritable, Text> {
    public void map(Object key, Text value, Context context)
            throws IOException, InterruptedException {
        String line = value.toString();
        String[] data = line.split(" ");
        if (data.length == 4) {
            int salary = Integer.parseInt(data[3]);
            if (salary > 50000) {
                context.write(NullWritable.get(), value);
            }
        }
    }
}
`,
  'EmployeeFilterReducer.java': `import java.io.IOException;
import org.apache.hadoop.io.NullWritable;
import org.apache.hadoop.io.Text;
import org.apache.hadoop.mapreduce.Reducer;

public class EmployeeFilterReducer extends Reducer<NullWritable, Text,
        NullWritable, Text> {
    public void reduce(NullWritable key,
            Iterable<Text> values,
            Context context)
            throws IOException, InterruptedException {
        for (Text value : values)
        {
            context.write(NullWritable.get(), value);
        }
    }
}
`,
  'EmployeeFilterDriver.java': `import org.apache.hadoop.conf.Configuration;
import org.apache.hadoop.fs.Path;
import org.apache.hadoop.io.NullWritable;
import org.apache.hadoop.io.Text;
import org.apache.hadoop.mapreduce.Job;
import org.apache.hadoop.mapreduce.lib.input.FileInputFormat;
import org.apache.hadoop.mapreduce.lib.output.FileOutputFormat;

public class EmployeeFilterDriver {
    public static void main(String[] args) throws Exception {
        Configuration conf = new Configuration();
        Job job = Job.getInstance(conf, "Employee Filter");
        job.setJarByClass(EmployeeFilterDriver.class);
        job.setMapperClass(EmployeeFilterMapper.class);
        job.setReducerClass(EmployeeFilterReducer.class);
        job.setOutputKeyClass(NullWritable.class);
        job.setOutputValueClass(Text.class);
        FileInputFormat.addInputPath(job, new Path(args[0]));
        FileOutputFormat.setOutputPath(job, new Path(args[1]));
        System.exit(job.waitForCompletion(true) ? 0 : 1);
    }
}
`,
};
const EMPLOYEE_TXT = `101 Rahul HR 45000
102 Neha IT 65000
103 Amit HR 55000
104 Priya Finance 70000
105 Riya IT 48000
106 Karan HR 60000
`;
const EMPLOYEE_CSV = `101,Rahul,IT,45000,Ahmedabad,Laptop
102,Neha,HR,40000,Mumbai,Mobile
103,Amit,IT,55000,Delhi,Laptop
104,Priya,Finance,60000,Pune,Tablet
105,Kiran,IT,50000,Ahmedabad,Mouse
106,Ravi,HR,35000,Mumbai,Mobile
107,Anita,Finance,65000,Delhi,Laptop
108,Arjun,IT,70000,Pune,Keyboard
109,Meena,HR,42000,Ahmedabad,Tablet
110,Rohan,Finance,58000,Mumbai,Mouse
`;
const DEPARTMENT_CSV = `1,IT,Mr. Sharma
2,HR,Ms. Patel
3,Finance,Mr. Mehta
4,Marketing,Mr. Shah
`;
const SAMPLE_FILES = {
  'employee_data.csv': EMPLOYEE_CSV, 'department.csv': DEPARTMENT_CSV, 'employee.txt': EMPLOYEE_TXT,
  'input.txt': 'Apple Orange Apple\nBanana Apple Orange\nMango Apple Banana\n',
  'grep.txt': 'Hadoop is Big Data Spark is Fast Hive works on Hadoop Hadoop is Open Source\n',
  'file1.txt': 'Apple Mango Banana Apple\n', 'file2.txt': 'Apple Orange Mango Orange\n',
  'student.csv': '101,Rahul,MCA,85\n102,Neha,MCA,92\n103,Amit,BCA,78\n104,Priya,MCA,88\n105,Riya,BCA,95\n',
};
G.JAVA = { PROGRAMS, NOTES_FILTER, SAMPLE_FILES, EMPLOYEE_CSV, DEPARTMENT_CSV };
})(typeof window !== 'undefined' ? window : globalThis);
