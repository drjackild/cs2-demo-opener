use std::path::PathBuf;
use std::env;
use protox::prost::Message;

fn main() {
    // Compile the proto files into a FileDescriptorSet using protox
    let file_descriptors = protox::compile(["../public/cs2_demo.proto"], ["../public/"])
        .expect("protox compilation failed");

    // Write descriptor set to file
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let descriptor_path = out_dir.join("file_descriptor_set.bin");
    std::fs::write(&descriptor_path, file_descriptors.encode_to_vec()).unwrap();

    // Tell prost-build to use descriptor set, output directly to src/, and skip protoc run
    prost_build::Config::new()
        .out_dir("src/")
        .file_descriptor_set_path(&descriptor_path)
        .skip_protoc_run()
        .compile_protos(&["../public/cs2_demo.proto"], &["../public/"])
        .unwrap();

    tauri_build::build();
}
