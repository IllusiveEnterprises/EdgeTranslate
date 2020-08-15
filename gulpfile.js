const _ = require("lodash");
const del = require("del");
const gulp = require("gulp");
const stylus = require("gulp-stylus");
const through = require("through2");
const webpack = require("webpack");
const webpack_stream = require("webpack-stream");
const zip = require("gulp-zip");
const terser = require("gulp-terser");
const eslint = require("gulp-eslint");

var browser; // store the name of browser
var environment; // store the type of environment: enum{production,development}

/**
 * define public tasks of gulp
 */
exports["buildJS:chrome"] = callback => {
    browser = "chrome";
    environment = "development";
    buildJS();
    callback();
};
exports["buildJS:firefox"] = callback => {
    browser = "firefox";
    environment = "development";
    buildJS();
    callback();
};
exports["dev:chrome"] = callback => {
    browser = "chrome";
    environment = "development";
    gulp.series(clean, gulp.parallel(eslintJS, manifest, html, styl, packStatic), watcher)();
    callback();
};
exports["dev:firefox"] = callback => {
    browser = "firefox";
    environment = "development";
    gulp.series(clean, gulp.parallel(eslintJS, manifest, html, styl, packStatic), watcher)();
    callback();
};
exports["build:chrome"] = callback => {
    browser = "chrome";
    environment = "production";
    gulp.series(clean, gulp.parallel(eslintJS, buildJS, manifest, html, styl, packStatic))();
    callback();
};
exports["build:firefox"] = callback => {
    browser = "firefox";
    environment = "production";
    gulp.series(clean, gulp.parallel(eslintJS, buildJS, manifest, html, styl, packStatic))();
    callback();
};
exports["pack:chrome"] = callback => {
    browser = "chrome";
    environment = "production";
    gulp.series(
        clean,
        gulp.parallel(eslintJS, buildJS, manifest, html, styl, packStatic),
        packToZip
    )();
    callback();
};
exports["pack:firefox"] = callback => {
    browser = "firefox";
    environment = "production";
    gulp.series(
        clean,
        gulp.parallel(eslintJS, buildJS, manifest, html, styl, packStatic),
        packToZip
    )();
    callback();
};
/**
 * End definition
 */

async function clean(callback) {
    let output_dir = "./build/" + browser + "/";
    let packageName = "edge_translate_" + browser + ".zip";
    await del([output_dir, output_dir + packageName]);
    callback();
}

/**
 * 将build的扩展打包成zip文件以备发布
 */
function packToZip(callback) {
    let match_dir = "./build/" + browser + "/**/*";
    let packageName = "edge_translate_" + browser + ".zip";
    gulp.src(match_dir)
        .pipe(zip(packageName))
        .pipe(gulp.dest("./build/"));
    callback();
}

function watcher(callback) {
    gulp.watch("./src/**/*.js").on("change", function() {
        eslintJS();
    });
    gulp.watch("./src/display/templates/*.html").on("change", function() {
        eslintJS();
    });
    gulp.watch("./src/(manifest|manifest_chrome|manifest_firefox).json").on("change", function() {
        manifest();
    });
    gulp.watch("./src/**/!(result|loading|error).html").on("change", function() {
        html();
    });
    gulp.watch("./static/**/*").on("change", function() {
        packStatic();
    });
    gulp.watch("./src/**/*.styl").on("change", function() {
        styl();
    });
    callback();
}

function eslintJS() {
    return gulp
        .src("./src/**/*.js", { base: "src" })
        .pipe(
            eslint({
                configFile: "./.eslintrc.js"
            })
        )
        .pipe(eslint.format());
}

function buildJS() {
    let output_dir = "./build/" + browser + "/";
    let webpack_path =
        environment === "production"
            ? "./config/webpack.prod.config.js"
            : "./config/webpack.dev.config.js"; // webpack 配置文件路径
    return gulp
        .src("./src/**/*.js", { base: "src" })
        .pipe(webpack_stream(require(webpack_path), webpack))
        .pipe(gulp.dest(output_dir))
        .on("error", error => log(error));
}

function manifest() {
    let output_dir = "./build/" + browser + "/";
    let manifest_patch = "./src/manifest_" + browser + ".json";
    return gulp
        .src("./src/manifest.json", { base: "src" })
        .pipe(merge_json(manifest_patch))
        .pipe(gulp.dest(output_dir))
        .on("end", function() {
            log("Finished build manifest files");
        });
}

function html(callback) {
    let output_dir = "./build/" + browser + "/";
    gulp.src(["./src/**/!(result|loading|error).html"], { base: "src" })
        .pipe(gulp.dest(output_dir))
        .on("end", function() {
            log("Finished build html files");
        });
    callback();
}

function styl() {
    let output_dir = "./build/" + browser + "/";
    return gulp
        .src("./src/!(lib)/**/*.styl", { base: "src" })
        .pipe(
            stylus({
                compress: true // 需要压缩
                // eslint-disable-next-line no-console
            }).on("error", error => console.log(error))
        )
        .pipe(gulp.dest(output_dir))
        .on("end", function() {
            log("Finished build stylus files");
        });
}

function packStatic() {
    let output_dir = "./build/" + browser + "/";
    if (browser === "chrome") {
        gulp.src("./static/**/!(element_main).js", { base: "static" })
            .pipe(terser().on("error", error => log(error)))
            .pipe(gulp.dest(output_dir));

        // Do not uglify element_main.js
        gulp.src("./static/google/element_main.js", { base: "static" }).pipe(gulp.dest(output_dir));

        return gulp.src("./static/**/!(*.js)", { base: "static" }).pipe(gulp.dest(output_dir));
    } else {
        // gulp.src("./static/!(pdf)/**/!(element_main).js", { base: "static" })
        //     .pipe(terser().on("error", error => log(error)))
        //     .pipe(gulp.dest(output_dir));

        // Do not uglify element_main.js
        // gulp.src("./static/google/element_main.js", { base: "static" }).pipe(gulp.dest(output_dir));

        return gulp
            .src("./static/!(pdf|google|youdao)/**/*", { base: "static" })
            .pipe(gulp.dest(output_dir));
    }
}

/**
 * 一个简易gulp插件，接收一组json文件作为参数，将它们合并到gulp.src引用的基本json文件；
 * 在这里的作用是合并公共manifest和不同浏览器特有的manifest。
 */
function merge_json() {
    let objs = [];
    for (let i in arguments) {
        objs.push(require(arguments[i]));
    }

    let stream = through.obj(function(file, enc, callback) {
        let obj = JSON.parse(file.contents.toString(enc));
        for (let i in objs) {
            obj = _.defaultsDeep(obj, objs[i]);
        }

        file.contents = Buffer.from(JSON.stringify(obj));
        this.push(file);
        callback();
    });

    return stream;
}

// 定义 log函数 ，便于输出task的执行情况
function log(d) {
    process.stdout.write(d + "\n");
}
