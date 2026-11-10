$ErrorActionPreference = 'Stop'
$source = @"
using System;
using System.Collections.Generic;
using System.Data;
using System.Data.OleDb;
using System.Globalization;
using System.IO;
using System.Text;

public static class DietProAccessExport
{
    private static readonly CultureInfo Culture = CultureInfo.InvariantCulture;
    private static readonly string[] Providers = {
        "Microsoft.Jet.OLEDB.4.0", "Microsoft.ACE.OLEDB.16.0", "Microsoft.ACE.OLEDB.12.0"
    };
    private static readonly string[] Tables = {
        "t_activity", "t_activitygroup", "t_authornote", "t_calendaractivity", "t_calendarday",
        "t_calendarentry", "t_calendarnote", "t_cookbook", "t_cookingtechnique", "t_cookingtechniquegroup",
        "t_cookingtechniquegroupassociation", "t_cookingtechniquetext", "t_glossaryitem", "t_glossaryitemtext",
        "t_grocerylist", "t_grocerylistitem", "t_ingredient", "t_ingredientgroup", "t_ingredientgroupassociation",
        "t_ingredientmeasure", "t_ingredientnote", "t_meal", "t_measure", "t_menu", "t_menuitem", "t_pantryitem",
        "t_profile", "t_recipe", "t_recipegroup", "t_recipegroupassociation", "t_recipeingredient",
        "t_recipenutrition", "t_recipeprocedure", "t_recipereview", "t_recipetype", "t_store"
    };

    public static string ConvertFile(string input, string output)
    {
        bool providerAvailable = false;
        foreach (string provider in Providers)
        {
            using (var connection = new OleDbConnection())
            {
                try
                {
                    var builder = new OleDbConnectionStringBuilder { Provider = provider, DataSource = input };
                    builder["Mode"] = "Read";
                    connection.ConnectionString = builder.ConnectionString;
                    connection.Open();
                }
                catch (InvalidOperationException)
                {
                    continue;
                }
                catch (OleDbException)
                {
                    providerAvailable = true;
                    continue;
                }

                var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                using (DataTable catalog = connection.GetOleDbSchemaTable(OleDbSchemaGuid.Tables, new object[] { null, null, null, "TABLE" }))
                {
                    foreach (DataRow row in catalog.Rows)
                        names.Add((string)row["TABLE_NAME"]);
                }
                foreach (string required in new[] { "t_profile", "t_recipe", "t_ingredient" })
                    if (!names.Contains(required)) return "DIETPRO_TABLES";

                foreach (string table in Tables)
                    if (names.Contains(table)) ExportTable(connection, table, output);
                return "";
            }
        }
        return providerAvailable ? "DIETPRO_OPEN" : "DIETPRO_PROVIDER";
    }

    private static void ExportTable(OleDbConnection connection, string table, string output)
    {
        using (var command = connection.CreateCommand())
        {
            command.CommandText = "SELECT * FROM [" + table + "]";
            using (var reader = command.ExecuteReader())
            using (var writer = new StreamWriter(Path.Combine(output, table + ".csv"), false, new UTF8Encoding(false)))
            {
                var line = new StringBuilder();
                var values = new object[reader.FieldCount];
                for (int i = 0; i < values.Length; i++) values[i] = reader.GetName(i);
                WriteRow(writer, line, values);
                while (reader.Read())
                {
                    reader.GetValues(values);
                    WriteRow(writer, line, values);
                }
            }
        }
    }

    private static void WriteRow(StreamWriter writer, StringBuilder line, object[] values)
    {
        line.Clear();
        for (int i = 0; i < values.Length; i++)
        {
            if (i > 0) line.Append(',');
            object value = values[i];
            string text = "";
            if (value is DateTime)
                text = ((DateTime)value).ToString("yyyy-MM-dd HH:mm:ss", Culture);
            else if (value is bool)
                text = (bool)value ? "Y" : "N";
            else if (value != null && !(value is DBNull) && !(value is byte[]))
                text = Convert.ToString(value, Culture);
            line.Append('"').Append(text.Replace("\u0022", "\u0022\u0022")).Append('"');
        }
        writer.WriteLine(line.ToString());
    }
}
"@
try {
    Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.dll','System.Core.dll','System.Data.dll','System.Xml.dll' -ErrorAction Stop
    $code = [DietProAccessExport]::ConvertFile($env:DIETPRO_MDB_SOURCE, $env:DIETPRO_CSV_DEST)
    if ($code) { [Console]::Error.WriteLine($code); exit 1 }
} catch {
    [Console]::Error.WriteLine('DIETPRO_EXPORT')
    exit 1
}
