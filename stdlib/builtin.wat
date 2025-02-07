(module  
  (import "js" "memory" (memory $0 1))
  (import "js" "heap" (global $heap (mut i32)))
  (import "check" "check_init" (func $check_init (param i32) (result i32)))
  (import "check" "check_index" (func $check_index (param i32) (param i32) (result i32)))
  ;; (global $heap (mut i32) (i32.const 4))
  
  (func $copy_list_string (param $src i32) (param $addr i32)
    (local $i i32)
    (local $len i32)
    (local.get $src)
    (i32.load)
    (local.set $len)
    (local.set $i (i32.const 0))
    (block
      (loop
        (br_if 1 (i32.eq (local.get $i) (local.get $len)))
        (i32.mul (local.get $i) (i32.const 4))
        (i32.add (local.get $addr))
        (i32.mul (local.get $i) (i32.const 4))
        (i32.add (i32.const 4))
        (i32.add (local.get $src))
        (i32.load)
        (i32.store)
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br 0)
      )
    )
  )

  (func (export "$concat_list_string") (param i32) (param i32) (result i32)
    (global.get $heap)
    (local.get 0)
    (call $check_init)
    (i32.load)
    (local.get 1)
    (call $check_init)
    (i32.load)
    (i32.add)
    (i32.store) ;; store new length
    (local.get 0)
    (i32.add (global.get $heap) (i32.const 4))
    (call $copy_list_string)
    (local.get 1)
    (i32.load (local.get 0))
    (i32.mul (i32.const 4))
    (i32.add (i32.const 4))
    (i32.add (global.get $heap))
    (call $copy_list_string)
    (global.get $heap) ;; return addr
    (global.get $heap)
    (i32.load (global.get $heap))
    (i32.mul (i32.const 4))
    (i32.add (i32.const 4))
    (i32.add)
    (global.set $heap)
  )

  (func (export "$get_string_index") (param $addr i32) (param $idx i32) (result i32)
    (local $val i32)
    (local.get $addr)
    (i32.add (i32.const 4))
    (local.get $addr)
    (call $check_init)
    (i32.load) ;; load the length of the list
    (local.get $idx)
    (call $check_index)
    (i32.mul (i32.const 4))
    (i32.add)
    (i32.load)
    (local.set $val) ;; put the value here
    (global.get $heap)
    (i32.const 1)
    (i32.store)
    (global.get $heap)
    (i32.add (i32.const 4))
    (local.get $val)
    (i32.store)
    (global.get $heap) ;; addr of the string
    (global.get $heap)
    (i32.add (i32.const 8))
    (global.set $heap)
  )

  (func (export "$get_list_index") (param $addr i32) (param $idx i32) (result i32)
    (local.get $addr)
    (call $check_init)
    (i32.load) ;; load the length of the list
    (local.get $idx)
    (call $check_index)
    (i32.mul (i32.const 4))
    (i32.add (i32.const 4))
    (i32.add (local.get $addr))
    (i32.load)
  )



  (func $eqstr (param i32) (param i32) (result i32)
    (local $i i32)
    (local $len i32)
    (local.get 0)
    (call $check_init)
    (i32.load) ;; load the length of the str1
    (local.set $len)
    (local.get $len)
    (local.get 1)
    (call $check_init)
    (i32.load) ;; load the length of the str2
    (i32.ne)
    (if
      (then
        (i32.const 0)
        return
      )
    )
    (local.set $i (i32.const 0)) 
    (block
      (loop 
        (i32.ge_s (local.get $i) (local.get $len))
        (br_if 1)
        (local.get 0)
        (i32.add (local.get $i) (i32.const 1))
        (i32.add (i32.mul (i32.const 4)))
        (i32.load)
        (local.get 1)
        (i32.add (local.get $i) (i32.const 1))
        (i32.add (i32.mul (i32.const 4)))
        (i32.load)
        (i32.ne)
        (if
          (then
            (i32.const 0)
            return
          )
        )
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br 0)
      )
    )
    (i32.const 1)
    return
  )

  (func (export "$streq") (param i32) (param i32) (result i32)
    (local.get 0)
    (local.get 1)
    (call $eqstr)
    return
  )

  (func (export "$strneq") (param i32) (param i32) (result i32)
    (i32.const 1)
    (local.get 0)
    (local.get 1)
    (call $eqstr)
    (i32.sub)
    return
  )


)