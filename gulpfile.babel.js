'use strict';

import plugins       from 'gulp-load-plugins';
import yargs         from 'yargs';
import browser       from 'browser-sync';
import gulp          from 'gulp';
import panini        from 'panini';
import rimraf        from 'rimraf';
import yaml          from 'js-yaml';
import fs            from 'fs';
import webpackStream from 'webpack-stream';
import webpack2      from 'webpack';
import named         from 'vinyl-named';
import uncss         from 'uncss';
import autoprefixer  from 'autoprefixer';

import ghpages       from 'gh-pages';

import inlineSvg  from 'postcss-inline-svg';

import rename       from 'gulp-rename';
import svgstore     from 'gulp-svgstore';
import svgmin       from 'gulp-svgmin';
import inject       from 'gulp-inject';

// Load all Gulp plugins into one variable
const $ = plugins();

// Check for --production flag
const PRODUCTION = !!(yargs.argv.production);

// Load settings from settings.yml
const { PORT, UNCSS_OPTIONS, PATHS } = loadConfig();

function loadConfig() {
  let ymlFile = fs.readFileSync('config.yml', 'utf8');
  return yaml.load(ymlFile);
}

// Build the "dist" folder by running all of the below tasks
// Sass must be run later so UnCSS can search for used classes in the others assets.
gulp.task('build',
 gulp.series(clean, gulp.parallel(pages, javascript, images, copy), sass, svgicons));

// Build the site, run the server, and watch for file changes
gulp.task('default',
  gulp.series('build', server, watch));

// 'gulp deploy' -- pushes your dist folder to Github
gulp.task('deploy',
  gulp.series('build', copycname, deployment)
);

gulp.task('phpbuild',
  gulp.series('build', cleanphp, copydist)
);

function copycname() {
  return gulp.src('CNAME').pipe(gulp.dest(PATHS.dist));
}

function deployment() {
  return ghpages.publish(PATHS.dist);
};


// Delete the "dist" folder
// This happens every time a build starts
function clean(done) {
  rimraf(PATHS.dist, done);
}

function cleanphp(done) {
    rimraf(PATHS.distphp, done);
  }

// Copy files out of the assets folder
// This task skips over the "img", "js", and "scss" folders, which are parsed separately
function copy() {
  return gulp.src(PATHS.assets)
    .pipe(gulp.dest(PATHS.dist + '/assetsapp'));
}

function copydist() {
    return gulp.src(PATHS.dist + '/**/*')
        .pipe(rename(function (path) {
            if (path.extname == ".html" ) {
                path.extname = ".php"
            }
        }))
      .pipe(gulp.dest(PATHS.distphp));
  }

// Copy page templates into finished HTML files
function pages() {
  return gulp.src('src/pages/**/*.{html,hbs,handlebars}')
    .pipe(panini({
      root: 'src/pages/',
      layouts: 'src/layouts/',
      partials: 'src/partials/',
      data: 'src/data/',
      helpers: 'src/helpers/'
    }))
    .pipe(gulp.dest(PATHS.dist));
}

// Load updated HTML templates and partials into Panini
function resetPages(done) {
  panini.refresh();
  done();
}


// Compile Sass into CSS
// In production, the CSS is compressed
function sass() {

  const postCssPlugins = [
    
    inlineSvg({
        paths: ['src/assetsapp/iconcollection/']
    }),

    // Autoprefixer
    autoprefixer(),

    // UnCSS - Uncomment to remove unused styles in production
    // PRODUCTION && uncss.postcssPlugin(UNCSS_OPTIONS),
  ].filter(Boolean);

  return gulp.src('src/assetsapp/scss/app.scss')
    .pipe($.sourcemaps.init())
    .pipe($.sass({
      includePaths: PATHS.sass
    })
      .on('error', $.sass.logError))
    .pipe($.postcss(postCssPlugins))
    .pipe($.if(PRODUCTION, $.cleanCss({ compatibility: 'ie9' })))
    .pipe($.if(!PRODUCTION, $.sourcemaps.write()))
    .pipe(gulp.dest(PATHS.dist + '/assetsapp/css'))
    .pipe(browser.reload({ stream: true }));
}

let webpackConfig = {
  mode: (PRODUCTION ? 'production' : 'development'),
  module: {
    rules: [
      {
        test: /\.js$/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [ "@babel/preset-env" ],
            compact: false
          }
        }
      }
    ]
  },
  devtool: !PRODUCTION && 'source-map'
}

// Combine JavaScript into one file
// In production, the file is minified
function javascript() {
  return gulp.src(PATHS.entries)
    .pipe(named())
    .pipe($.sourcemaps.init())
    .pipe(webpackStream(webpackConfig, webpack2))
    .pipe($.if(PRODUCTION, $.terser()
      .on('error', e => { console.log(e); })
    ))
    .pipe($.if(!PRODUCTION, $.sourcemaps.write()))
    .pipe(gulp.dest(PATHS.dist + '/assetsapp/js'));
}

// Copy images to the "dist" folder
// In production, the images are compressed
function images() {
  return gulp.src('src/assetsapp/img/**/*')
    .pipe($.if(PRODUCTION, $.imagemin([
      $.imagemin.jpegtran({ progressive: true }),
    ])))
    .pipe(gulp.dest(PATHS.dist + '/assetsapp/img'));
}

// Start a server with BrowserSync to preview the site in
function server(done) {
  browser.init({
    server: PATHS.dist, port: PORT
  }, done);
}

// Reload the browser with BrowserSync
function reload(done) {
  browser.reload();
  done();
}

// ### SVG icons inject
function svgicons() {
    var svgs = gulp.src('src/assetsapp/iconcollection/*.svg')
        .pipe(rename({ prefix: 'icon-' }))
        .pipe(svgmin())
        .pipe(svgstore({ inlineSvg: true }));

    function fileContents(filePath, file) {
        return file.contents.toString();
    }

    return gulp.src('src/partials/iconsprite.html')
        .pipe(inject(svgs, { transform: fileContents }))
        .pipe(gulp.dest('src/partials'));
};


// Watch for changes to static assets, pages, Sass, and JavaScript
function watch() {
  gulp.watch(PATHS.assets, copy);
  gulp.watch('src/assetsapp/iconcollection/*.svg').on('all', gulp.series(svgicons, browser.reload));
  gulp.watch('src/pages/**/*.html').on('all', gulp.series(pages, browser.reload));
  gulp.watch('src/{layouts,partials}/**/*.html').on('all', gulp.series(resetPages, pages, browser.reload));
  gulp.watch('src/data/**/*.{js,json,yml}').on('all', gulp.series(resetPages, pages, browser.reload));
  gulp.watch('src/helpers/**/*.js').on('all', gulp.series(resetPages, pages, browser.reload));
  gulp.watch('src/assetsapp/scss/**/*.scss').on('all', sass);
  gulp.watch('src/assetsapp/js/**/*.js').on('all', gulp.series(javascript, browser.reload));
  gulp.watch('src/assetsapp/img/**/*').on('all', gulp.series(images, browser.reload));
}
